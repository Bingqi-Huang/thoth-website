// Full-length replays are large and may be hosted apart from the site; set VITE_VIDEO_BASE at build time.
export const VIDEO_BASE: string = import.meta.env.VITE_VIDEO_BASE ?? "media/video/";
