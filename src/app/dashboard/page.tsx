import { Footer } from "@/app/components/footer";
import { Main } from "@/app/components/main";
import { Navigation } from "@/app/components/navigation";
import { URL } from "@/app/constants";
import ManifestComponent from "@/app/context/manifest";
import type { Metadata } from "next";
import { Suspense } from "react";
import DashboardView from "./dashboard-view";

export async function generateMetadata(): Promise<Metadata> {
    return {
        title: "Library dashboard",
        alternates: {
            canonical: `${URL}/dashboard`,
        },
    };
}

export default function Page() {
    return (
        <ManifestComponent>
            <Navigation />
            <Main>
                <Suspense>
                    <DashboardView />
                </Suspense>
            </Main>
            <Footer />
        </ManifestComponent>
    );
}
