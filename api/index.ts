import { apiApp } from '../lib/api.js';
export default { fetch: (request: Request) => apiApp.fetch(request) };
