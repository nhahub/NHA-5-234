apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${PROJECT_NAME}
  namespace: ${NAMESPACE}
  labels: { app: ${PROJECT_NAME}, managed-by: autodeployers }
spec:
  replicas: ${REPLICAS}
  selector:
    matchLabels: { app: ${PROJECT_NAME} }
  template:
    metadata:
      labels: { app: ${PROJECT_NAME} }
    spec:
      containers:
        - name: app
          image: ${IMAGE}
          ports:
            - containerPort: ${APP_PORT}
          resources:
            requests: { cpu: 50m, memory: 64Mi }
            limits:   { cpu: 200m, memory: 128Mi }
---
apiVersion: v1
kind: Service
metadata:
  name: ${PROJECT_NAME}
  namespace: ${NAMESPACE}
spec:
  type: NodePort
  selector: { app: ${PROJECT_NAME} }
  ports:
    - port: 80
      targetPort: ${APP_PORT}
      nodePort: ${NODE_PORT}
