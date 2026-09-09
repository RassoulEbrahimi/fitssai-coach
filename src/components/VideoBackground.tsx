import { useCallback, useEffect, useRef, useState } from "react";
import { usePreferences } from "@/contexts/PreferencesContext";
import { useTheme } from "@/hooks/useTheme";

const StaticBackground = () => {
  const { actualTheme } = useTheme();
  return (
    <img
      src={`${import.meta.env.BASE_URL}backgrounds/dashboard-bg-${actualTheme}-v1.webp`}
      className="bg-still absolute inset-0 h-full w-full object-cover"
      width={1920}
      height={1080}
      alt=""
      decoding="async"
    />
  );
};

const AnimatedVideo = ({ onFailure }: { onFailure: () => void }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let active = true;
    const fail = () => { if (active) onFailure(); };
    video.addEventListener("error", fail);
    // Assign only in the mounted Animated branch. Reassign on effect setup
    // so React Strict Mode's cleanup/setup cycle also remains safe.
    video.src = `${import.meta.env.BASE_URL}video/dashboard-bg.mp4`;
    try {
      void video.play().catch(fail);
    } catch {
      fail();
    }

    return () => {
      active = false;
      video.removeEventListener("error", fail);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [onFailure]);

  return (
    <video
      ref={videoRef}
      className="bg-video absolute inset-0 h-full w-full object-cover"
      loop
      muted
      playsInline
      preload="none"
      data-test-id="video-bg-video"
    />
  );
};

const AnimatedBackground = () => {
  const [failed, setFailed] = useState(false);
  const onFailure = useCallback(() => setFailed(true), []);
  // A failure releases the player without changing the saved preference.
  // Selecting Static then Animated (or remounting the dashboard) can retry.
  return failed ? <StaticBackground /> : <AnimatedVideo onFailure={onFailure} />;
};

const VideoBackground = () => {
  const { backgroundMode } = usePreferences();
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[1] overflow-hidden bg-background"
      aria-hidden="true"
      data-test-id="video-bg-root"
    >
      {backgroundMode === "animated" ? <AnimatedBackground /> : <StaticBackground />}
      <div
        className="absolute inset-0 pointer-events-none bg-gradient-to-b from-background/40 to-background/80 z-10"
        aria-hidden="true"
      />
    </div>
  );
};

export default VideoBackground;
