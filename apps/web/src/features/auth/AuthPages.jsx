import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import FormField from '../../components/ui/FormField.jsx';
import Button from '../../components/ui/Button.jsx';
import { Notice } from '../../components/ui/Feedback.jsx';
import { authService } from '../../services/store.service.js';
import { parseError } from '../../services/api.js';
import { useAuthStore } from '../../stores/authStore.js';

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="container-page flex justify-center py-10 sm:py-16">
      <div className="w-full max-w-md">
        <h1 className="h-section text-center">{title}</h1>
        <p className="mt-2 text-center text-sm text-muted">{subtitle}</p>
        <div className="card mt-8 p-5 sm:p-8">{children}</div>
        <p className="mt-6 text-center text-sm text-muted">{footer}</p>
      </div>
    </div>
  );
}

function useAuthForm(mutationFn) {
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();
  const location = useLocation();
  const [err, setErr] = useState({ message: '', fields: {} });
  const mutation = useMutation({
    mutationFn,
    onSuccess: ({ token, user }) => {
      setSession({ token, user });
      const from = location.state?.from;
      navigate(user.role === 'admin' ? '/admin' : from && !from.startsWith('/admin') ? from : '/account', { replace: true });
    },
    onError: (e) => setErr(parseError(e)),
  });
  return { mutation, err, setErr };
}

export function LoginPage() {
  const user = useAuthStore((s) => s.user);
  const { mutation, err, setErr } = useAuthForm(authService.login);
  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/account'} replace />;

  const onSubmit = (e) => {
    e.preventDefault();
    setErr({ message: '', fields: {} });
    const f = new FormData(e.currentTarget);
    mutation.mutate({ email: f.get('email'), password: f.get('password') });
  };

  return (
    <AuthShell title="Welcome back" subtitle="Log in to your account"
      footer={<>New here? <Link to="/register" className="font-medium text-brand hover:underline">Create an account</Link></>}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {err.message && <Notice type="error">{err.message}</Notice>}
        <FormField label="Email" name="email" type="email" autoComplete="email" required error={err.fields.email} />
        <FormField label="Password" name="password" type="password" autoComplete="current-password" required error={err.fields.password} />
        <Button type="submit" className="w-full" loading={mutation.isPending}>Log in</Button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const user = useAuthStore((s) => s.user);
  const { mutation, err, setErr } = useAuthForm(authService.register);
  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/account'} replace />;

  const onSubmit = (e) => {
    e.preventDefault();
    setErr({ message: '', fields: {} });
    const f = new FormData(e.currentTarget);
    if (f.get('password') !== f.get('confirm')) {
      return setErr({ message: 'Please fix the errors below', fields: { confirm: 'Passwords do not match' } });
    }
    return mutation.mutate({ fullName: f.get('fullName'), email: f.get('email'), password: f.get('password') });
  };

  return (
    <AuthShell title="Create your account" subtitle="Save favourites and manage your details"
      footer={<>Already registered? <Link to="/login" className="font-medium text-brand hover:underline">Log in</Link></>}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {err.message && <Notice type="error">{err.message}</Notice>}
        <FormField label="Full name" name="fullName" autoComplete="name" required error={err.fields.fullName} />
        <FormField label="Email" name="email" type="email" autoComplete="email" required error={err.fields.email} />
        <FormField label="Password" name="password" type="password" autoComplete="new-password" required
          hint="At least 8 characters, with a letter and a number" error={err.fields.password} />
        <FormField label="Confirm password" name="confirm" type="password" autoComplete="new-password" required error={err.fields.confirm} />
        <Button type="submit" className="w-full" loading={mutation.isPending}>Create account</Button>
      </form>
    </AuthShell>
  );
}
