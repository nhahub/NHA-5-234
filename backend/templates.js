// Starter templates: they only pre-fill the form (port, replicas, a repo to try) - they do not
// change how the pipeline runs. Any repo with a Dockerfile at its root works with any template.
export const TEMPLATES = [
  {
    id: 'node-api',
    name: 'Node.js API',
    description: 'A small Express-style HTTP API. Matches the bundled sample-app.',
    defaultPort: 3000,
    defaultReplicas: 2,
    sampleRepoUrl: 'https://github.com/YOUR_USER/sample-app',
  },
  {
    id: 'python-flask',
    name: 'Python (Flask)',
    description: 'A Flask app served with gunicorn. Needs EXPOSE 5000 in its Dockerfile.',
    defaultPort: 5000,
    defaultReplicas: 2,
    sampleRepoUrl: 'https://github.com/docker/awesome-compose',
  },
  {
    id: 'static-site',
    name: 'Static site (Nginx)',
    description: 'A prebuilt static site served by Nginx. Needs EXPOSE 80 in its Dockerfile.',
    defaultPort: 80,
    defaultReplicas: 1,
    sampleRepoUrl: '',
  },
  {
    id: 'custom',
    name: 'Custom / other',
    description: 'Any repository with a Dockerfile at its root. Set the port it listens on.',
    defaultPort: 3000,
    defaultReplicas: 1,
    sampleRepoUrl: '',
  },
];

export const templateById = (id) => TEMPLATES.find((t) => t.id === id);
