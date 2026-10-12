import { Link } from 'react-router-dom';
import './index.css';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
}

export default function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <header className="header">
      <div className="header-top">
        <Link to="/" className="back-link">
          ←
        </Link>
        <h1>{title}</h1>
      </div>
      {subtitle && <p className="subtitle">{subtitle}</p>}
    </header>
  );
}
