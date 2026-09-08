/** Shared video-call tile. Keep TalkingPhoto and RealtimeAvatar in lockstep. */
export const AVATAR_STAGE = {
  width: "min(20.5rem, 86vw)",
  height: "min(26.5rem, 52vh)",
  radius: "1.25rem",
} as const;

/** Literal crop of the current picture: 7% off the top, 7% off the bottom. No pan. */
export const AVATAR_CROP_TOP = 0.07;
export const AVATAR_CROP_BOTTOM = 0.07;
export const AVATAR_VISIBLE_Y = 1 - AVATAR_CROP_TOP - AVATAR_CROP_BOTTOM;

/** Shorter frame after the equal top/bottom crop — leaves more room for the spoken line. */
export function avatarStageFrameHeight(): string {
  return `calc((${AVATAR_STAGE.height}) * ${AVATAR_VISIBLE_Y})`;
}

/**
 * Inner media is the uncropped tile, shifted so only top/bottom are clipped.
 * Width and horizontal position stay the same.
 */
export function avatarCropInnerStyle() {
  return {
    position: "absolute" as const,
    left: 0,
    width: "100%",
    height: `${(1 / AVATAR_VISIBLE_Y) * 100}%`,
    top: `${-(AVATAR_CROP_TOP / AVATAR_VISIBLE_Y) * 100}%`,
  };
}
