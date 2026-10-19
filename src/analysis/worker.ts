// Analysis Web Worker entry point stub
export interface WorkerAnalysisRequest {
  trackId: string;
}

export interface WorkerAnalysisResponse {
  trackId: string;
  status: 'pending' | 'success' | 'error';
}
