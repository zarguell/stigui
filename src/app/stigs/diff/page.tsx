import { Footer } from "@/app/components/footer";
import { Main } from "@/app/components/main";
import { Navigation } from "@/app/components/navigation";
import { URL } from "@/app/constants";
import ManifestComponent from "@/app/context/manifest";
import type { Metadata } from "next";
import { Suspense } from "react";
import DiffView from "./diff-view";

export async function generateMetadata(): Promise<Metadata> {
    return {
        title: "Release changes",
        alternates: {
            canonical: `${URL}/stigs/diff`,
        },
    };
}

/**
 * One shared client route for every release diff (like /stigs/rules for
 * recommendations) — the static export stays small regardless of how
 * many version comparisons exist.
 */
export default function Page() {
    return (
        <ManifestComponent>
            <Navigation />
            <Main>
                <Suspense>
                    <DiffView />
                </Suspense>
            </Main>
            <Footer />
        </ManifestComponent>
    );
}
