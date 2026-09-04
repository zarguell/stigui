export const debounce = (func: Function, delay: number) => {
    let timeout: NodeJS.Timeout;
    return function (...args: any[]) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
};

export const download = (url: string, filename: string) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
};

/**
 * Free-text rule search: case-insensitive substring match across the
 * fields assessors search — ids, title, discussion, check, fix text,
 * and reviewer notes. An empty query matches everything.
 */
export const ruleMatchesSearch = (
    rule: {
        rule_id: string;
        group_id: string;
        rule_version: string;
        rule_title: string;
        discussion: string;
        check_content: string;
        fix_text: string;
        comments: string;
        finding_details: string;
    },
    rawQuery: string
): boolean => {
    const query = rawQuery.trim().toLowerCase();
    if (query.length === 0) {
        return true;
    }
    return [
        rule.rule_id,
        rule.group_id,
        rule.rule_version,
        rule.rule_title,
        rule.discussion,
        rule.check_content,
        rule.fix_text,
        rule.comments,
        rule.finding_details,
    ].some((field) => field?.toLowerCase().includes(query));
};
