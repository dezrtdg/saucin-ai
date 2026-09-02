export default function DashboardLoading(){
  return <div className="dashboardPageLoading" role="status" aria-live="polite">
    <span className="dashboardPageLoadingSpinner" aria-hidden="true"/>
    <div><strong>Loading…</strong><span>Updating the Saucin AI console.</span></div>
  </div>;
}
