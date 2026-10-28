# AutoDeployers – Intelligent Infrastructure Automation Platform

Dashboard → sign-in (RBAC) → pipeline scripts → (Terraform + Ansible on AWS **or** MicroK8s on your machine) → Docker Hub → Kubernetes → Gemini for cost advice.

```
frontend/   React dashboard (Vite): login, deploy form, history       scripts/    provision / configure / build / deploy / destroy
backend/    Node + Express + SQLite + auth + Gemini                   terraform/  EC2 + security group          (TARGET=aws)
jenkins/    Jenkinsfile                                               ansible/    installs k3s, fetches kubeconfig (TARGET=aws)
k8s/        Deployment + Service template                            sample-app/ tiny app to test the pipeline
```

## Two settings control everything (`backend/.env`)
| Variable | Values | Meaning |
|---|---|---|
| `ORCHESTRATOR` | `local` (default), `jenkins` | who runs the pipeline. `local` = the scripts, through WSL on Windows |
| `TARGET` | `microk8s` (default), `aws` | where apps run. `microk8s` = your machine, free. `aws` = one EC2 server running k3s |
| `DRY_RUN` | `1` / `0` | `1` simulates every step (no WSL, Docker, Kubernetes or AWS needed) |

The old `MODE` variable still works (`MODE=jenkins` → `ORCHESTRATOR=jenkins`, `MODE=aws` → `TARGET=aws`).
Every app gets its own public port (30100–30199) and a namespace per environment. Deployments run one at a time.

## Accounts (basic role-based access control)
Two roles, seeded automatically the first time the backend starts, from `backend/.env`:

| Role | Can do |
|---|---|
| `admin` | everything: start deployments, apply AI-suggested changes |
| `viewer` | read-only: watch deployments, logs, and the AI's advice, but can't start anything or apply changes |

Default accounts (**change these in `.env` before sharing the app**): `admin` / `admin123`, `viewer` / `viewer123`.
The dashboard shows a sign-in screen first; sign-in issues a token used for every API call, valid 12 hours.

## Step 1 – Simulation (no tools needed)
```bash
cd backend && cp .env.example .env && npm install && npm start      # API on :4000, DRY_RUN=1
cd frontend && npm install && npm run dev                           # http://localhost:5173
```

## Step 2 – Real deployments on your machine (TARGET=microk8s)
On Windows the backend runs the scripts inside WSL Ubuntu, so install these **inside WSL**: `git`, `gettext-base` (for `envsubst`),
Docker (Docker Desktop with WSL integration is fine) and MicroK8s:
```bash
sudo snap install microk8s --classic
sudo usermod -a -G microk8s $USER        # then open a new WSL terminal
microk8s status --wait-ready
microk8s enable metrics-server           # optional: lets the AI see CPU/memory
```
Set `DRY_RUN=0`, `DOCKER_USER`, `DOCKER_TOKEN` in `backend/.env`. The repository you deploy needs a Dockerfile at its root, and the
Docker Hub repository must be **public** (MicroK8s pulls it without credentials). The app opens at `http://localhost:<port shown in the log>`.
Remove an app: `microk8s kubectl delete namespace dev`.

## Step 3 – AWS (TARGET=aws), inside the free tier
- **One EC2 instance only.** The first deployment creates it, later ones reuse it. The 750 free hours are shared by all instances.
- Default type `t3.micro` (eligible on every account type). Accounts created on/after 15 Jul 2025 can also set `INSTANCE_TYPE=t3.small`.
  k3s on 1 GB RAM is tight: keep apps tiny.
- Jenkins, the backend, Docker builds, Terraform and Ansible run on **your computer**, not on AWS.
- Never use: NAT Gateway, load balancers, EKS, RDS, extra Elastic IPs, a second instance.
- Needs: terraform, ansible, kubectl inside WSL, `aws configure` (or `AWS_*` variables in `.env`), an EC2 key pair (`SSH_KEY_PATH`, a `.pem` stored in WSL with `chmod 600`).
- **Run `bash scripts/destroy.sh` (with `TARGET=aws`) after every session**, then check the EC2 console for leftover instances or volumes.
- Create a zero-spend budget in AWS Budgets on day one. On the new "Free plan" never upgrade to the "Paid plan".
- Test the scripts by hand first: `TARGET=aws PROJECT_NAME=demo ENVIRONMENT=dev REPLICAS=1 APP_PORT=3000 NODE_PORT=30100 REPO_URL=... DOCKER_USER=... DOCKER_TOKEN=... SSH_KEY_PATH=... bash scripts/provision.sh` (then configure, build, deploy).

## Step 4 – Jenkins (optional)
Install Jenkins on the same machine, add credentials `dockerhub` (and `aws-creds`, `aws-ssh` for `TARGET=aws`), create a Pipeline job named
`autodeployers` from `jenkins/Jenkinsfile`, create `/var/lib/autodeployers`, then set `ORCHESTRATOR=jenkins`, `DATA_DIR=/var/lib/autodeployers`
and the `JENKINS_*` values.

## Deployment templates
The "New deployment" form has a template picker (Node.js API, Python/Flask, Static site/Nginx, Custom). Choosing one only pre-fills the
port and replica count and shows a suggested sample repo — it doesn't change how the pipeline runs, so any repo with a Dockerfile at its
root works with any template. Add more templates in `backend/templates.js`.

## History
The "History" tab lists every deployment (not just the current session's), filterable by status, environment, or name. Clicking a row
opens its full detail: pipeline progress, logs, and every AI action applied to it (the "Action history" panel).

## AI (Gemini)
Set `GEMINI_API_KEY` (key is sent in a header, never in the URL). "Suggest cost savings" sends live cluster state and similar past deployments
(simple retrieval from SQLite); the only action the backend will execute is changing the replica count (0–5) — available to admins only.
"Explain this failure" appears on failed deployments. kubectl calls go through the same WSL/bash path as the pipeline, so kubectl does not
need to be installed on Windows directly.

## Security
Never share or commit `backend/.env` or any `kubeconfig`. If a token or key was shared, revoke it and create a new one.
Change the default admin/viewer passwords and `AUTH_SECRET` before showing this to anyone else.
`.gitattributes` forces LF line endings on shell scripts: CRLF breaks them in WSL.

## What matches the project brief, and what doesn't
Core features (dashboard, Git repo input, Terraform, Ansible, Jenkins pipeline, status/log tracking) and all four bonus features
(AI failure explainer, deployment templates, history view, role-based access) are implemented. Not implemented, because the brief
itself lists them as "Future Work" / "Post-graduation vision": multi-cloud support, advanced monitoring, pre-deployment cost estimates,
a microservices split, a message queue, managed Kubernetes, a mobile app, natural-language deployment requests, AI incident summaries,
and GitHub/GitLab/ECR/S3 integrations beyond what's already used.
