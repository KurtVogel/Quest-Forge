/**
 * Simple markdown renderer for chat messages.
 * Handles: **bold**, *italic*, line breaks, and paragraphs.
 * No external dependencies needed.
 */
export default function MarkdownText({ text }) {
    if (!text) return null;

    // Split into paragraphs by double newlines
    const paragraphs = text.split(/\n{2,}/);

    return (
        <>
            {paragraphs.map((para, i) => (
                <p key={i} className="md-paragraph">
                    {renderInline(para)}
                </p>
            ))}
        </>
    );
}

function renderInline(text) {
    // Process inline markdown: bold, italic, bold-italic, inline code
    // Order matters: process bold-italic (***) before bold (**) and italic (*)
    const parts = [];
    // Regex to match: ***bold-italic***, **bold**, *italic*, `code`, or plain text
    const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+?)`)/g;

    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        // Add plain text before the match
        if (match.index > lastIndex) {
            parts.push(processLineBreaks(text.slice(lastIndex, match.index), parts.length));
        }

        if (match[2]) {
            // ***bold-italic***
            parts.push(<strong key={`bi-${match.index}`}><em>{match[2]}</em></strong>);
        } else if (match[3]) {
            // **bold**
            parts.push(<strong key={`b-${match.index}`}>{match[3]}</strong>);
        } else if (match[4]) {
            // *italic*
            parts.push(<em key={`i-${match.index}`}>{match[4]}</em>);
        } else if (match[5]) {
            // `inline code`
            parts.push(<code key={`c-${match.index}`} className="md-code">{match[5]}</code>);
        }

        lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
        parts.push(processLineBreaks(text.slice(lastIndex), parts.length));
    }

    return parts;
}

function processLineBreaks(text, keyBase) {
    // Convert single newlines to <br>
    const lines = text.split('\n');
    if (lines.length === 1) return text;

    return lines.map((line, i) => (
        <span key={`lb-${keyBase}-${i}`}>
            {line}
            {i < lines.length - 1 && <br />}
        </span>
    ));
}
