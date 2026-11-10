// Central persistence boundary: screen pixels only live in memory, even while a turn is running.
export function chatSnapshot(messages) {
 return messages.map(m => ({ ...m, ...(m.media ? { media: m.media.map(x => x.ephemeral ? { kind:'screen-reference',name:x.name,source:x.source } : x) } : {}) }));
}
