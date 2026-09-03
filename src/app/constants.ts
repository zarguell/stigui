export const URL = "https://zarguell.github.io/stigui";
export const APPNAME = "STIGUI";

/**
 * GitHub Pages serves project sites from a subpath. Set
 * NEXT_PUBLIC_BASE_PATH to the repository name when building for Pages;
 * local development and root-domain deploys leave it unset.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
