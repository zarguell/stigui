"use client";
import { GroupView } from "@/app/components/group";
import StigComponent from "@/app/context/stig";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";

/**
 * Rule pages render client-side from one shared route — prerendering
 * one page per recommendation (55k+) dominated the static export time.
 * Agents and crawlers use the markdown mirror instead:
 * /markdown/stigs/<id>.md (see /llms.txt).
 */
const RulesView = () => {
    // Read the query from the location directly: through useSearchParams
    // the static-export hydration cycle re-renders this view with empty
    // params after the content has already mounted, blanking the page.
    const [params, setParams] = useState(
        () =>
            new URLSearchParams(
                typeof window === "undefined" ? "" : window.location.search
            )
    );
    useEffect(() => {
        const sync = () => setParams(new URLSearchParams(window.location.search));
        window.addEventListener("popstate", sync);
        return () => window.removeEventListener("popstate", sync);
    }, []);
    const stigId = params.get("stig");
    const groupId = params.get("group");

    if (!stigId || !groupId) {
        return (
            <p className="text-sm text-muted mt-6">
                No recommendation selected. Pick a benchmark from the{" "}
                <Link className="text-accent hover:underline" href="/stigs">
                    STIG library
                </Link>{" "}
                and open one of its recommendations.
            </p>
        );
    }

    return (
        <StigComponent stigId={stigId}>
            <GroupView stigId={stigId} groupId={groupId} />
        </StigComponent>
    );
};

export default function RulesViewPage() {
    return (
        <Suspense fallback={<p className="text-sm text-muted mt-6">Loading…</p>}>
            <RulesView />
        </Suspense>
    );
}
