import ui from './ui.module.css';

export function ErrorCard({ message }: { message: string }) {
  return (
    <div role="alert" className={`${ui.card} ${ui.stack}`}>
      <h2>No pudimos cargar tus datos</h2>
      <p>{message}</p>
      <p>Revisa que la aplicación esté encendida y vuelve a abrir esta página.</p>
    </div>
  );
}
