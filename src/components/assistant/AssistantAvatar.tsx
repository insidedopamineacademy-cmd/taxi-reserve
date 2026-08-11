"use client";

import Image from "next/image";

type Props = {
  size?: "small" | "medium" | "launcher";
  className?: string;
};

const sizeClasses = {
  small: "size-7",
  medium: "size-10",
  launcher: "size-full",
};

export function AssistantAvatar({ size = "medium", className = "" }: Props) {
  return (
    <span
      aria-hidden="true"
      className={`${sizeClasses[size]} relative block shrink-0 overflow-hidden rounded-full bg-black ${className}`}
    >
      <Image
        src="/assistant/assistant-portrait.webp"
        alt=""
        fill
        sizes={size === "launcher" ? "56px" : size === "medium" ? "40px" : "28px"}
        className="object-cover"
      />
    </span>
  );
}
