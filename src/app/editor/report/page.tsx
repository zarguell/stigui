import { Footer } from "@/app/components/footer";
import { Navigation } from "@/app/components/navigation";
import { URL } from "@/app/constants";
import type { Metadata } from "next";
import { Suspense } from "react";
import ReportView from "./report-view";

export async function generateMetadata(): Promise<Metadata> {
    return {
        title: "Findings report",
        alternates: {
            canonical: `${URL}/editor/report`,
        },
    };
}

export default function Page() {
    return (
        <Suspense>
            <div className="print-report w-full">
                <Navigation />
                <main className="w-full max-w-screen-xl mx-auto p-4">
                    <ReportView />
                </main>
                <Footer />
            </div>
        </Suspense>
    );
}
