import { redirect } from 'next/navigation';
import SettingsNav from '../../components/SettingsNav';
import { can, getDashboardAccess } from '../../lib/permissions';

export default async function SettingsLayout({children}:{children:React.ReactNode}){
  const access=await getDashboardAccess();
  if(!can(access,'settings.view')) redirect('/');
  return <><SettingsNav permissions={access.permissions||[]} ownerBypass={Boolean(access.owner_bypass)}/>{children}</>;
}
