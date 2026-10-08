/** Иконки (inline SVG, 24×24, обводка) — без внешних зависимостей. */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: string[], displayName: string) {
  const Icon = ({ size = 16, ...props }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
  Icon.displayName = displayName;
  return Icon;
}

export const IconBook = make(["M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z", "M4 19a2 2 0 0 1 2-2h13", "M9 7h6"], "IconBook");
export const IconPhone = make(
  ["M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"],
  "IconPhone",
);
export const IconBoard = make(["M4 4h16v16H4z", "M9.5 4v16", "M15 4v16"], "IconBoard");
export const IconUsers = make(
  ["M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M22 20v-1a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  "IconUsers",
);
export const IconHistory = make(["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5", "M12 7v5l3 2"], "IconHistory");
export const IconSearch = make(["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z", "m21 21-4.3-4.3"], "IconSearch");
export const IconMenu = make(["M4 6h16", "M4 12h16", "M4 18h16"], "IconMenu");
export const IconX = make(["M18 6 6 18", "m6 6 12 12"], "IconX");
export const IconPlus = make(["M12 5v14", "M5 12h14"], "IconPlus");
export const IconPencil = make(["M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"], "IconPencil");
export const IconTrash = make(["M3 6h18", "M8 6V4h8v2", "M19 6l-1 14H6L5 6", "M10 11v6", "M14 11v6"], "IconTrash");
export const IconChevronRight = make(["m9 18 6-6-6-6"], "IconChevronRight");
export const IconChevronDown = make(["m6 9 6 6 6-6"], "IconChevronDown");
export const IconArrowUp = make(["M12 19V5", "m5 12 7-7 7 7"], "IconArrowUp");
export const IconArrowDown = make(["M12 5v14", "m19 12-7 7-7-7"], "IconArrowDown");
export const IconCopy = make(["M8 8h12v12H8z", "M16 8V4H4v12h4"], "IconCopy");
export const IconCheck = make(["M20 6 9 17l-5-5"], "IconCheck");
export const IconSun = make(
  ["M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z", "M12 1v2", "M12 21v2", "M4.2 4.2l1.4 1.4", "M18.4 18.4l1.4 1.4", "M1 12h2", "M21 12h2", "M4.2 19.8l1.4-1.4", "M18.4 5.6l1.4-1.4"],
  "IconSun",
);
export const IconMoon = make(["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"], "IconMoon");
export const IconLogout = make(["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "m16 17 5-5-5-5", "M21 12H9"], "IconLogout");
export const IconFile = make(["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z", "M14 2v6h6"], "IconFile");
export const IconPaperclip = make(
  ["m21.4 11-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"],
  "IconPaperclip",
);
export const IconGrip = make(["M9 6h.01", "M15 6h.01", "M9 12h.01", "M15 12h.01", "M9 18h.01", "M15 18h.01"], "IconGrip");
export const IconList = make(["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"], "IconList");
export const IconShield = make(["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"], "IconShield");
export const IconUser = make(["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"], "IconUser");
