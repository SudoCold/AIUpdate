import { apiApp } from '../lib/api';
export default { fetch: (request: Request) => apiApp.fetch(request) };
