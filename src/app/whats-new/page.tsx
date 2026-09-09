import { Footer } from "@/app/components/footer";
import { Main } from "@/app/components/main";
import { Navigation } from "@/app/components/navigation";
import { URL } from "@/app/constants";
import ManifestComponent from "@/app/context/manifest";
import type { Metadata } from "next";
import { Suspense } from "react";
import WhatsNewView from "./whats-new-view";

export async function generateMetadata(): Promise<Metadata> {
    return {
        title: "What's new",
        alternates: {
            canonical: `${URL}/whats-new`,
        },
    };
}

export default function Page() {
    return (
        <ManifestComponent>
            <Navigation />
            <Main>
                <Suspense>
                    <WhatsNewView />
                </Suspense>
            </Main>
            <Footer />
        </ManifestComponent>
    );
}
