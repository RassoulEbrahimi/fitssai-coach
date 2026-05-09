import React, { useEffect, useRef } from "react";

const VideoBackground: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Detect reduced motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const handleVideoReady = async () => {
      if (prefersReducedMotion) {
        // For reduced motion: pause and seek to middle frame
        video.pause();
        if (video.duration && isFinite(video.duration)) {
          video.currentTime = video.duration / 2;
        }
      } else {
        // Normal autoplay behavior
        try {
          await video.play();
        } catch (error) {
          console.debug("Video autoplay was prevented:", error);
        }
      }
    };

    // Attempt to play/handle when metadata is loaded (duration is available)
    video.addEventListener("loadedmetadata", handleVideoReady);

    // Also attempt immediately if metadata already loaded
    if (video.readyState >= 1) {
      handleVideoReady();
    }

    return () => {
      video.removeEventListener("loadedmetadata", handleVideoReady);
    };
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[1] overflow-hidden"
      aria-hidden="true"
      data-test-id="video-bg-root"
    >
      {/* Animated background video (hidden in reduce-motion by CSS) */}
      <video
        ref={videoRef}
        className="bg-video absolute inset-0 w-full h-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        data-test-id="video-bg-video"
      >
        <source src={`${import.meta.env.BASE_URL}video/dashboard-bg.webm`} type="video/webm" />
        <source src={`${import.meta.env.BASE_URL}video/dashboard-bg.mp4`} type="video/mp4" />
        Dein Browser unterstützt kein Video-Tag.
      </video>

      {/* Contrast overlay to keep text readable */}
      <div
        className="absolute inset-0 pointer-events-none bg-gradient-to-b from-background/40 to-background/80 z-10"
        aria-hidden="true"
      />
    </div>
  );
};

export default VideoBackground;
