import { Footer } from "@/app/components/footer";
import { Main } from "@/app/components/main";
import { Navigation } from "@/app/components/navigation";
import { Stigs } from "@/app/components/stigs";
import { URL } from "@/app/constants";
import ManifestComponent from "@/app/context/manifest";
import type { Metadata } from "next";
import { Suspense } from "react";

export async function generateMetadata(): Promise<Metadata> {
    return {
        title: "Security Technical Implementation Guides (STIGs)",
        alternates: {
            canonical: `${URL}/stigs`,
        },
    };
}

export default async function Page() {
    return (
        <ManifestComponent>
            <Navigation />
            <Main>
                {/* Without a boundary, a client component that suspends on
                    the manifest promise during hydration can leave the
                    subtree stuck on server HTML — never interactive. */}
                <Suspense>
                    <Stigs />
                </Suspense>
            </Main>
            <Footer />
        </ManifestComponent>
    );
}
