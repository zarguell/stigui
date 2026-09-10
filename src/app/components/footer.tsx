import { BASE_PATH } from "@/app/constants";

export const Footer = () => (
    <footer className="bg-surface border-t border-border">
        <div className="w-full max-w-screen-xl mx-auto p-4 md:py-8 flex flex-col items-center gap-2">
            <span className="text-sm text-muted text-center">
                A community{" "}
                <a
                    href="https://github.com/zarguell/stigui"
                    className="text-foreground hover:underline transition-colors"
                    tabIndex={80}
                >
                    fork of STIGUI
                </a>{" "}
                by Neal Fennimore, maintained by{" "}
                <a
                    href="https://github.com/zarguell"
                    className="text-foreground hover:underline transition-colors"
                    tabIndex={80}
                >
                    Zach Arguelles
                </a>{" "}
                — adding STIG &amp; checklist upload, legacy CKL support,
                STIG version migration, statistics, rule search, and
                NIST 800-53 control mapping. Everything runs locally in
                your browser.
            </span>
            <span className="flex flex-row items-center justify-center text-sm text-subtle">
                © 2026{" "}
                <a
                    href="https://github.com/zarguell/stigui"
                    className="hover:text-foreground hover:underline mx-1 transition-colors"
                    tabIndex={70}
                >
                    zarguell/stigui
                </a>
                · based on{" "}
                <a
                    href="https://github.com/nealfennimore/stig"
                    className="hover:text-foreground hover:underline mx-1 transition-colors"
                    tabIndex={70}
                >
                    STIGUI (MIT)
                </a>
                <a
                    href={`${BASE_PATH}/editor`}
                    className="ml-3 text-muted hover:text-foreground transition-colors"
                    aria-label="Open the checklist editor"
                    tabIndex={100}
                >
                    Editor
                </a>
                <a
                    href={`${BASE_PATH}/rss.xml`}
                    className="ml-3 text-muted hover:text-foreground transition-colors"
                    aria-label="Subscribe to library releases via RSS"
                    tabIndex={100}
                >
                    RSS
                </a>
            </span>
        </div>
    </footer>
);
