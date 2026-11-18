import { type FunctionalComponent, h } from "vue";

type Shape = ["path", string] | ["circle", number, number, number];

/**
 * Glyphs copied from the design system sprite (apps/web/public/icons.svg).
 * The remote draws them inline: the sprite lives on the host origin and the
 * remote must also work standalone. Single stroke, 1.6 on 24x24, currentColor.
 */
const ICONS = {
  alert: [
    ["path", "M12 4 2.8 20h18.4z"],
    ["path", "M12 10v4M12 17.2v.3"],
  ],
  arrowR: [["path", "M4 12h15M14 6.5 19.5 12 14 17.5"]],
  block: [
    ["circle", 12, 12, 8.5],
    ["path", "M6 6l12 12"],
  ],
  calendar: [
    ["path", "M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"],
    ["path", "M4 10h16M9 3v4M15 3v4"],
  ],
  check: [["path", "m5 13 4.5 4.5L19 8"]],
  check2: [
    ["circle", 12, 12, 8.5],
    ["path", "m8.5 12.2 2.4 2.4 4.6-4.8"],
  ],
  chevL: [["path", "m15 6-6 6 6 6"]],
  chevR: [["path", "m9 6 6 6-6 6"]],
  clock: [
    ["circle", 12, 12, 8.5],
    ["path", "M12 7.5V12l3 2"],
  ],
  flag: [
    ["path", "M6 21V4"],
    ["path", "M6 5h11l-2.5 3.5L17 12H6"],
  ],
  folders: [["path", "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"]],
  info: [
    ["circle", 12, 12, 8.5],
    ["path", "M12 11v5M12 7.8v.3"],
  ],
  pulse: [["path", "M3 12h4l2.5-6 4 12 2.5-6h5"]],
  scroll: [
    ["path", "M7 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7"],
    ["path", "M7 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2"],
    ["path", "M10 9h6M10 13h6"],
  ],
  target: [
    ["path", "M12 4l6 8-6 8-6-8z"],
    ["path", "M12 8.5 14.5 12 12 15.5 9.5 12z"],
  ],
  x: [["path", "M6 6l12 12M18 6 6 18"]],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

/** Decorative glyph (aria-hidden): the visible label next to it carries the meaning. */
export const Icon: FunctionalComponent<{ name: IconName; size?: number }> = (props) => {
  const size = props.size ?? 16;
  const shapes: Shape[] = ICONS[props.name];
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.6,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    shapes.map((shape) =>
      shape[0] === "path"
        ? h("path", { d: shape[1] })
        : h("circle", { cx: shape[1], cy: shape[2], r: shape[3] }),
    ),
  );
};
Icon.props = ["name", "size"];
