"use client";
import { useEffect, useState } from "react";
import { loadCciMap, type CciMap } from "@/api/entities/cci";

export const useCciMap = (): CciMap | null => {
    const [map, setMap] = useState<CciMap | null>(null);
    useEffect(() => {
        let cancelled = false;
        loadCciMap().then((loaded) => {
            if (!cancelled && loaded.ccis && Object.keys(loaded.ccis).length > 0) {
                setMap(loaded);
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);
    return map;
};
