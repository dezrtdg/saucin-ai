export default function SuggestionsLoading(){
  return <div className="dashboardPageLoading" role="status" aria-live="polite">
    <span className="dashboardPageLoadingSpinner" aria-hidden="true"/>
    <div><strong>Loading suggestions…</strong><span>Refreshing community ideas and support counts.</span></div>
  </div>;
}
