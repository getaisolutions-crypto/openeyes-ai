import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';

export default function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" description="This page does not exist." />
      <Link to="/" className="btn-primary">
        Go to Home
      </Link>
    </>
  );
}
