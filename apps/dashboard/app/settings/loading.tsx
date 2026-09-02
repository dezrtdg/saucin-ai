export default function SettingsLoading(){
  return <div className="dashboardPageLoading" role="status" aria-live="polite">
    <span className="dashboardPageLoadingSpinner" aria-hidden="true"/>
    <div><strong>Loading settings…</strong><span>Refreshing the Saucin AI settings panel.</span></div>
  </div>;
}
