import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const client = axios.create({ baseURL: API, timeout: 20000 });

export const api = {
  overview: () => client.get("/stats/overview").then(r => r.data),
  traffic: (hours = 24) => client.get(`/stats/traffic?hours=${hours}`).then(r => r.data),
  topSenders: () => client.get("/stats/top-senders").then(r => r.data),

  quarantine: (params = {}) => client.get("/quarantine", { params }).then(r => r.data),
  quarantineGet: (id) => client.get(`/quarantine/${id}`).then(r => r.data),
  quarantineRelease: (ids) => client.post("/quarantine/release", { ids }).then(r => r.data),
  quarantineDelete: (ids) => client.post("/quarantine/delete", { ids }).then(r => r.data),
  quarantineReport: (ids) => client.post("/quarantine/report-spam", { ids }).then(r => r.data),

  lists: (params = {}) => client.get("/lists", { params }).then(r => r.data),
  listAdd: (payload) => client.post("/lists", payload).then(r => r.data),
  listDel: (id) => client.delete(`/lists/${id}`).then(r => r.data),

  rules: () => client.get("/rules").then(r => r.data),
  ruleAdd: (payload) => client.post("/rules", payload).then(r => r.data),
  ruleDel: (id) => client.delete(`/rules/${id}`).then(r => r.data),
  ruleUpdate: (id, payload) => client.put(`/rules/${id}`, payload).then(r => r.data),

  engines: () => client.get("/engines").then(r => r.data),
  engineToggle: (name) => client.post(`/engines/${name}/toggle`).then(r => r.data),

  settings: () => client.get("/settings").then(r => r.data),
  settingsPut: (payload) => client.put("/settings", payload).then(r => r.data),

  users: () => client.get("/users").then(r => r.data),
  logs: (params = {}) => client.get("/logs", { params }).then(r => r.data),
  outbound: () => client.get("/outbound").then(r => r.data),

  scanTest: (payload) => client.post("/scan/test", payload).then(r => r.data),
};
