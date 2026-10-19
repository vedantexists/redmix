// SoundTouch audio worklet registration stub
export async function registerSoundTouchWorklet(ctx: AudioContext): Promise<boolean> {
  if (!ctx.audioWorklet) {
    return false;
  }
  return true;
}
