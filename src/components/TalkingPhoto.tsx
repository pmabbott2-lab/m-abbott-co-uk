import susanImg from "@/assets/susan-window.png";
import { AVATAR_STAGE, avatarCropInnerStyle, avatarStageFrameHeight } from "@/lib/avatar-frame";

/**
 * Static Susan portrait — fallback only when the live avatar cannot connect.
 * No glow, pulse, or breathing: just her in the same box as the live tile.
 */

type Props = {
  speaking?: boolean;
  listening?: boolean;
  getAmplitude?: () => number;
  usingBrowserVoice?: boolean;
  size?: number;
  layout?: "circle" | "stage";
};

export function TalkingPhoto({ size = 240, layout = "circle" }: Props) {
  const stage = layout === "stage";
  const width = stage ? AVATAR_STAGE.width : size;
  const height = stage ? avatarStageFrameHeight() : size;
  const frameRadius = stage ? AVATAR_STAGE.radius : "9999px";

  return (
    <div className="relative inline-block" style={{ width, height }}>
      <div
        className="absolute inset-0 overflow-hidden shadow-sm ring-1 ring-border/50"
        style={{ borderRadius: frameRadius }}
      >
        <img
          src={susanImg}
          alt="Susan, your interview guide"
          draggable={false}
          style={{
            ...avatarCropInnerStyle(),
            objectFit: "cover",
            objectPosition: "top",
            userSelect: "none",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}
