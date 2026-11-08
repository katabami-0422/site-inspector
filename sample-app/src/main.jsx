import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const features = [
  {
    title: "写真に注釈",
    body: "指で囲んで、気づいたことをそのまま書き残せます。現場で手が止まりません。",
  },
  {
    title: "日報に自動で反映",
    body: "その日の写真とメモが、日報の下書きにまとまります。事務所に戻ってからの転記は不要です。",
  },
  {
    title: "事務所と共有",
    body: "共有リンクを送るだけ。取引先にアプリのインストールを頼む必要はありません。",
  },
];

function App() {
  return (
    <div className="page">
      <header className="topbar">
        <span className="logo">現場ノート</span>
        <nav className="nav" aria-label="メイン">
          <a href="#features">機能</a>
          <a href="#price">料金</a>
          <a className="nav-cta" href="#start">
            無料で始める
          </a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <p className="eyebrow">建設・設備工事の記録アプリ</p>
          <h1 className="hero-title">現場の写真を、その日のうちに共有する</h1>
          <p className="hero-lede">
            撮った写真に一言添えるだけで、事務所と現場の記録がそろいます。説明のための資料づくりに、作業時間を削られません。
          </p>
          <div className="hero-actions">
            <a className="cta" href="#start">
              無料ではじめる
            </a>
            <a className="ghost" href="#demo">
              デモを見る（3分）
            </a>
          </div>
          <p className="hero-note">クレジットカード不要 · 現場ごとのフォルダを自動作成</p>
        </section>

        <section className="stats" aria-label="利用実績">
          <div>
            <strong>1,240</strong>
            <span>導入現場</span>
          </div>
          <div>
            <strong>3.2分</strong>
            <span>日報作成にかかる時間</span>
          </div>
          <div>
            <strong>98%</strong>
            <span>翌日までに共有できた割合</span>
          </div>
        </section>

        <section id="features" className="features">
          <h2>現場で完結する3つの機能</h2>
          <div className="cards">
            {features.map((feature) => (
              <article className="card" key={feature.title}>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>現場ノート</span>
        <span>Site Inspector の動作確認用サンプルです。</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
