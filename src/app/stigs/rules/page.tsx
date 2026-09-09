import { Footer } from "@/app/components/footer";
import { Main } from "@/app/components/main";
import { Navigation } from "@/app/components/navigation";
import { URL } from "@/app/constants";
import ManifestComponent from "@/app/context/manifest";
import type { Metadata } from "next";
import { Suspense } from "react";
import RulesView from "./rules-view";

export async function generateMetadata(): Promise<Metadata> {
    return {
        title: "Recommendation",
        alternates: {
            canonical: `${URL}/stigs/rules`,
        },
    };
}

export default function Page() {
    return (
        <Suspense>
            <ManifestComponent>
                <Navigation />
                <Main>
                    <RulesView />
                </Main>
                <Footer />
            </ManifestComponent>
        </Suspense>
    );
}
