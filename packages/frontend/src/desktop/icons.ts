import chart from "./icons/chart.png";
import computer from "./icons/computer.png";
import faucet from "./icons/faucet.svg";
import keys from "./icons/keys.png";
import star from "./icons/star.png";
import user from "./icons/user.png";
import vault from "./icons/vault.png";

/** Original Win95 32×32 icons (via @react95/icons PNGs) + a custom faucet. */
export const ICONS = {
  chart,
  computer,
  faucet,
  keys,
  star,
  user,
  vault,
} as const;

export type IconName = keyof typeof ICONS;
