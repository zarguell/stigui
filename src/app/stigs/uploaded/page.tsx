import { Footer } from "@/app/components/footer";
import { Main } from "@/app/components/main";
import { Navigation } from "@/app/components/navigation";
import { URL } from "@/app/constants";
import ManifestComponent from "@/app/context/manifest";
import type { Metadata } from "next";
import { Suspense } from "react";
import UploadedStigView from "./uploaded-view";

export async function generateMetadata(): Promise<Metadata> {
    return {
        title: "Imported STIGs",
        alternates: {
            canonical: `${URL}/stigs/uploaded`,
        },
    };
}

export default function Page() {
    return (
        <Suspense>
            <ManifestComponent>
                <Navigation />
                <Main>
                    <UploadedStigView />
                </Main>
                <Footer />
            </ManifestComponent>
        </Suspense>
    );
}
