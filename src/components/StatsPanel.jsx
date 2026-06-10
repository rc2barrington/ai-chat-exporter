import { useMemo } from "react";

export function StatsPanel({ session }) {
  const stats = useMemo(() => {
    if (!session || !session.messages) return null;

    let totalWords = 0;
    let totalCharacters = 0;
    const roleCounts = {};
    const toolCounts = {};

    for (const msg of session.messages) {
      const isUser = msg.role === "## You";
      const roleLabel = isUser ? "You" : "Assistant";
      roleCounts[roleLabel] = (roleCounts[roleLabel] || 0) + 1;

      for (const block of msg.blocks) {
        if (block.type === "text" && block.text) {
          totalCharacters += block.text.length;
          totalWords += block.text.trim().split(/\s+/).filter(Boolean).length;
        } else if (block.type === "thinking" && block.thinking) {
          totalCharacters += block.thinking.length;
          totalWords += block.thinking.trim().split(/\s+/).filter(Boolean).length;
        } else if (block.type === "tool_use") {
          if (block.name) {
            toolCounts[block.name] = (toolCounts[block.name] || 0) + 1;
          }
          if (block.input) {
            const str = typeof block.input === "string" ? block.input : JSON.stringify(block.input);
            totalCharacters += str.length;
            totalWords += str.trim().split(/\s+/).filter(Boolean).length;
          }
        } else if (block.type === "tool_result" && block.content) {
          totalCharacters += String(block.content).length;
          totalWords += String(block.content).trim().split(/\s+/).filter(Boolean).length;
        }
      }
    }

    const sortedTools = Object.entries(toolCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const tokenEstimate = Math.round(totalWords * 1.33);

    return {
      totalWords,
      totalCharacters,
      tokenEstimate,
      roleCounts,
      messageCount: session.messages.length,
      sortedTools,
    };
  }, [session]);

  if (!stats) return null;

  const { totalWords, totalCharacters, tokenEstimate, roleCounts, messageCount, sortedTools } = stats;

  const youCount = roleCounts["You"] || 0;
  const assistantCount = roleCounts["Assistant"] || 0;
  const totalCount = youCount + assistantCount || 1;
  const youPercent = Math.round((youCount / totalCount) * 100);
  const assistantPercent = Math.round((assistantCount / totalCount) * 100);

  return (
    <div className="card-panel" style={{ marginBottom: 32 }}>
      <p className="card-title" style={{ marginBottom: 20 }}>Session Analytics</p>
      
      {/* 4-column metric cards grid */}
      <div style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 16,
        marginBottom: 28
      }}>
        <div style={metricCardStyle}>
          <span style={metricLabelStyle}>Total Messages</span>
          <span style={metricValueStyle}>{messageCount}</span>
        </div>
        <div style={metricCardStyle}>
          <span style={metricLabelStyle}>Word Count</span>
          <span style={metricValueStyle}>{totalWords.toLocaleString()}</span>
        </div>
        <div style={metricCardStyle}>
          <span style={metricLabelStyle}>Character Count</span>
          <span style={metricValueStyle}>{totalCharacters.toLocaleString()}</span>
        </div>
        <div style={metricCardStyle}>
          <span style={metricLabelStyle}>Estimated Tokens</span>
          <span style={metricValueStyle}>{tokenEstimate.toLocaleString()}</span>
        </div>
      </div>

      {/* Two-column layout for details */}
      <div style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 32,
        alignItems: "flex-start"
      }}>
        {/* Left Column: Message Ratios */}
        <div style={{ flex: "1 1 300px" }}>
          <h4 style={sectionHeaderStyle}>Message Ratio</h4>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
            <span style={{ color: "#a78bfa", fontWeight: 600 }}>🧑 You: {youCount} ({youPercent}%)</span>
            <span style={{ color: "#60a5fa", fontWeight: 600 }}>🤖 Assistant: {assistantCount} ({assistantPercent}%)</span>
          </div>
          {/* Progress bar container */}
          <div style={{
            height: 12,
            background: "rgba(255, 255, 255, 0.04)",
            borderRadius: 6,
            overflow: "hidden",
            display: "flex",
            border: "1px solid rgba(255, 255, 255, 0.06)"
          }}>
            <div style={{
              width: `${youPercent}%`,
              background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
              transition: "width 0.5s ease"
            }} />
            <div style={{
              width: `${assistantPercent}%`,
              background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
              transition: "width 0.5s ease"
            }} />
          </div>
        </div>

        {/* Right Column: Top Tools Called */}
        <div style={{ flex: "1 1 300px" }}>
          <h4 style={sectionHeaderStyle}>Top Tools Executed</h4>
          {sortedTools.length === 0 ? (
            <div style={{ fontSize: 13, color: "#64748b", fontStyle: "italic" }}>
              No tools executed in this session.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sortedTools.slice(0, 5).map((tool, idx) => (
                <div key={tool.name} style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "rgba(15, 23, 42, 0.25)",
                  border: "1px solid rgba(255, 255, 255, 0.04)",
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 13
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "#64748b", fontSize: 11, fontWeight: 700 }}>#{idx + 1}</span>
                    <code style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      color: "#f43f5e",
                      background: "rgba(244, 63, 94, 0.1)",
                      padding: "2px 6px",
                      borderRadius: 4,
                      fontSize: 12
                    }}>{tool.name}</code>
                  </div>
                  <span style={{
                    background: "rgba(255, 255, 255, 0.08)",
                    padding: "2px 8px",
                    borderRadius: 20,
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#cbd5e1"
                  }}>{tool.count} calls</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const metricCardStyle = {
  flex: "1 1 160px",
  background: "rgba(15, 23, 42, 0.25)",
  border: "1px solid rgba(255, 255, 255, 0.04)",
  padding: "16px",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
  gap: 4
};

const metricLabelStyle = {
  fontSize: 12,
  color: "#64748b",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em"
};

const metricValueStyle = {
  fontSize: 22,
  fontWeight: 800,
  color: "#f8fafc"
};

const sectionHeaderStyle = {
  fontSize: 14,
  fontWeight: 700,
  color: "#e2e8f0",
  marginTop: 0,
  marginBottom: 16,
  textTransform: "uppercase",
  letterSpacing: "0.05em"
};
