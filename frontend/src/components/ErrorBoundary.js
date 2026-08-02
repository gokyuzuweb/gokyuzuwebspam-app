import React from "react";

/**
 * ErrorBoundary — herhangi bir alt component'in runtime crash'inde tüm sayfanın
 * boş ekrana düşmesini engeller. Kullanıcıya net bir mesaj + reload butonu gösterir.
 * Ayrıca DevTools console'a stack trace loglar ki debug yapılabilsin.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[GWS ErrorBoundary]", error, info?.componentStack);
  }
  render() {
    if (this.state.hasError) {
      const label = this.props.label || "Sayfa";
      return (
        <div className="p-8 max-w-lg mx-auto text-center" data-testid="error-boundary">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-rose-500/15 border border-rose-500/40 flex items-center justify-center text-2xl">
            ⚠️
          </div>
          <div className="text-slate-100 font-semibold text-lg mb-1">
            {label} yüklenemedi
          </div>
          <p className="text-sm text-slate-400 mb-4">
            Bir bileşen hata verdi — sayfa boş kalmasın diye burada durduk. DevTools
            (F12) → Console'da tam stack trace'i görürsünüz.
          </p>
          <div className="text-[11px] mono bg-slate-900/80 rounded p-3 mb-4 border border-slate-800 text-rose-300 text-left overflow-auto max-h-40">
            {String(this.state.error?.message || this.state.error || "Unknown error")}
          </div>
          <button
            onClick={() => window.location.reload()}
            data-testid="error-boundary-reload"
            className="px-4 py-2 rounded bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-semibold"
          >
            Sayfayı Yenile
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
