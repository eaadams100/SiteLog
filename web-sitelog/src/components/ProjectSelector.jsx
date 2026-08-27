/**
 * components/ProjectSelector.jsx
 *
 * Dropdown of projects. Purely controlled — receives the project list
 * and current selection as props, calls onChange with the new project_id
 * when the person picks a different one. Fetching happens in App.jsx.
 */

export default function ProjectSelector({ projects, selectedProjectId, onChange }) {
  return (
    <div className="field">
      <label htmlFor="project-selector" className="field__label">
        Project
      </label>
      <select
        id="project-selector"
        className="field__select"
        value={selectedProjectId ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>
          Select a project…
        </option>
        {projects.map((project) => (
          <option key={project.project_id} value={project.project_id}>
            {project.name}
            {project.location ? ` — ${project.location}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}