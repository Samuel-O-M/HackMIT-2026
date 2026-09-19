import type { ProposedChange } from '../types/contract';

/**
 * The credibility surface. Collapsed by default, one interaction to open, and
 * it shows the actual calls rather than a paraphrase of them.
 */
export function ToolTrace({ change }: { change: ProposedChange }) {
  return (
    <div className="trace">
      <div className="trace-why">
        <h4>Why the agent proposed this</h4>
        <p>{change.agentReasoning}</p>
      </div>
      {change.toolTrace.length > 0 && (
        <table className="trace-steps">
          <caption>Tool calls</caption>
          <thead>
            <tr>
              <th scope="col">Tool</th>
              <th scope="col">Input</th>
              <th scope="col">Output</th>
            </tr>
          </thead>
          <tbody>
            {change.toolTrace.map((step, i) => (
              <tr key={`${step.tool}-${i}`}>
                <td className="mono">{step.tool}</td>
                <td>{step.input}</td>
                <td>
                  <span className="arrow">→ </span>
                  <span className="mono">{step.output}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
