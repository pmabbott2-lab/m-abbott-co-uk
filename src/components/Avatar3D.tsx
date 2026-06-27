import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { CanvasTexture, Color, MathUtils, MeshStandardMaterial, SRGBColorSpace, type Mesh, type Texture } from "three";
import { Avatar } from "@/components/Avatar";

const MODEL_SRC = "/avatar.glb";

// Framing for a head-and-shoulders shot of a full-body Ready Player Me avatar.
// The model stands with feet at y=0; its head centre sits near world y≈0.12 after
// we drop it down by MODEL_Y. We look at the head centre and keep the camera far
// enough back to show the whole head plus shoulders. Tweak if the crop looks off.
const MODEL_Y = -1.48;
const CAM_POS: [number, number, number] = [0, 0.12, 1.08];
const CAM_FOV = 24;
const LOOK_Y = 0.12;

// A natural, professional hair colour to replace the model's default.
const HAIR_COLOR = "#3f2d20";
const HAIR_RGB = { r: 0x3f, g: 0x2d, b: 0x20 };

/** Recolour purple/magenta pixels (the model's brows, baked into the face
 *  texture) to the hair brown, scaled by the pixel's own brightness so the brow
 *  shape and anti-aliasing are preserved. Returns a new texture, or null if the
 *  source has no such pixels. */
function recolourBrowsTexture(map: Texture): Texture | null {
  const img = map.image as (HTMLImageElement | ImageBitmap | HTMLCanvasElement) | undefined;
  const w = (img as { width?: number })?.width ?? 0;
  const h = (img as { height?: number })?.height ?? 0;
  if (!img || !w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    return null; // tainted canvas — give up gracefully
  }
  const px = data.data;
  let changed = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    // Purple/magenta: red and blue both clearly above green.
    if (r - g > 12 && b - g > 12) {
      const lum = (r + g + b) / 3;
      const f = Math.min(1.4, lum / 70); // keep relative shading
      px[i] = Math.min(255, HAIR_RGB.r * f);
      px[i + 1] = Math.min(255, HAIR_RGB.g * f);
      px[i + 2] = Math.min(255, HAIR_RGB.b * f);
      changed++;
    }
  }
  if (!changed) return null;
  ctx.putImageData(data, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.flipY = map.flipY;
  tex.colorSpace = map.colorSpace ?? SRGBColorSpace;
  tex.wrapS = map.wrapS;
  tex.wrapT = map.wrapT;
  tex.needsUpdate = true;
  return tex;
}

type Props = {
  /** True while Susan is speaking. */
  speaking?: boolean;
  /** True while listening on the mic. */
  listening?: boolean;
  /** Live 0..1 speech loudness for lip-sync (from useAudioPlayback). */
  getAmplitude?: () => number;
  /** Browser-voice sessions have no analysable stream — drive a procedural mouth. */
  usingBrowserVoice?: boolean;
  size?: number;
};

function HeadModel({ speaking, listening, getAmplitude, usingBrowserVoice }: Props) {
  const { scene } = useGLTF(MODEL_SRC);
  const blink = useRef({ next: 1.5, closing: false, start: 0 });

  const meshes = useMemo(() => {
    const list: Mesh[] = [];
    scene.traverse((o) => {
      const m = o as Mesh;
      if (m.morphTargetDictionary && m.morphTargetInfluences) list.push(m);
    });
    return list;
  }, [scene]);

  // Recolour the hair (a mesh) and the brows (baked into the face texture) to a
  // professional shade — the default model ships with bright purple hair/brows.
  useMemo(() => {
    const tint = new Color(HAIR_COLOR);
    const recoloured = new WeakSet<Texture>();
    scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const isHair = /hair/i.test(m.name);
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (!(mat instanceof MeshStandardMaterial)) continue;
        if (isHair) {
          mat.color.copy(tint);
          mat.map = null; // drop the tinted texture so the new colour reads cleanly
          mat.metalness = 0;
          mat.roughness = 0.85;
          mat.needsUpdate = true;
        } else if (mat.map && !recoloured.has(mat.map)) {
          recoloured.add(mat.map);
          const fixed = recolourBrowsTexture(mat.map);
          if (fixed) {
            mat.map = fixed;
            mat.needsUpdate = true;
          }
        }
      }
    });
  }, [scene]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;

    let amp = getAmplitude ? getAmplitude() : 0;
    if (speaking && usingBrowserVoice && amp < 0.02) {
      // Procedural jaw flap when there's no analysable audio (browser TTS).
      amp = 0.18 + 0.16 * Math.abs(Math.sin(t * 11)) + 0.08 * Math.abs(Math.sin(t * 17));
    }
    if (!speaking) amp = 0;
    const open = MathUtils.clamp(amp, 0, 1);

    // Blink scheduling: quick ~120ms blinks every 2–5s.
    const b = blink.current;
    if (!b.closing && t > b.next) {
      b.closing = true;
      b.start = t;
    }
    let blinkVal = 0;
    if (b.closing) {
      const k = (t - b.start) / 0.12;
      blinkVal = k < 1 ? Math.sin(k * Math.PI) : 0;
      if (k >= 1) {
        b.closing = false;
        b.next = t + 2 + Math.random() * 3;
      }
    }

    for (const mesh of meshes) {
      const dict = mesh.morphTargetDictionary!;
      const infl = mesh.morphTargetInfluences!;
      const set = (name: string, value: number, lambda = 12) => {
        const i = dict[name];
        if (i !== undefined) infl[i] = MathUtils.damp(infl[i] ?? 0, value, lambda, delta);
      };
      // Mouth open — prefer ARKit jawOpen, fall back to the Oculus "aa" viseme.
      // Kept well below 1 so loud syllables look like natural speech, not a yawn.
      if ("jawOpen" in dict) set("jawOpen", open * 0.55);
      else if ("viseme_aa" in dict) set("viseme_aa", open * 0.65);
      // A little rounded-vowel variety so it isn't a pure hinge.
      if ("viseme_O" in dict) set("viseme_O", open * 0.2, 10);
      if ("viseme_aa" in dict && "jawOpen" in dict) set("viseme_aa", open * 0.3, 10);
      // Friendly resting/listening smile.
      if ("mouthSmile" in dict) set("mouthSmile", listening ? 0.28 : 0.14, 6);
      // Blinks.
      const lb = dict["eyeBlinkLeft"];
      const rb = dict["eyeBlinkRight"];
      if (lb !== undefined) infl[lb] = blinkVal;
      if (rb !== undefined) infl[rb] = blinkVal;
    }

    // Subtle idle motion so she feels alive.
    scene.rotation.y = Math.sin(t * 0.5) * 0.04;
    scene.position.y = MODEL_Y + Math.sin(t * 1.2) * 0.004;
  });

  return <primitive object={scene} position={[0, MODEL_Y, 0]} />;
}

/** Falls back to the 2D avatar if WebGL or the model fails. */
class GlFallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("3D avatar unavailable, falling back to 2D", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function Avatar3D(props: Props) {
  const { speaking, listening, size = 240 } = props;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fallback = <Avatar speaking={speaking} listening={listening} size={size} />;

  // SSR / first paint: render the 2D avatar until the client mounts.
  if (!mounted) return fallback;

  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      <div
        className={`absolute inset-0 rounded-full ${listening ? "pulse-ring" : ""}`}
        style={{ background: "radial-gradient(circle at 30% 30%, oklch(0.78 0.16 55 / 0.25), transparent 65%)" }}
      />
      <div
        className="absolute inset-0 rounded-full overflow-hidden"
        style={{ transform: speaking ? "scale(1.02)" : "scale(1)", transition: "transform 200ms" }}
      >
        <GlFallback fallback={fallback}>
          <Canvas
            camera={{ position: CAM_POS, fov: CAM_FOV }}
            gl={{ alpha: true, antialias: true }}
            onCreated={({ camera }) => camera.lookAt(0, LOOK_Y, 0)}
          >
            <ambientLight intensity={1.1} />
            <directionalLight position={[1.5, 2, 2]} intensity={1.8} />
            <directionalLight position={[-2, 1, 1]} intensity={0.5} />
            <Suspense fallback={null}>
              <HeadModel {...props} />
            </Suspense>
          </Canvas>
        </GlFallback>
      </div>
    </div>
  );
}

useGLTF.preload(MODEL_SRC);
