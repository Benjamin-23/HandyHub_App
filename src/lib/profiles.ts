import { decode } from 'base64-arraybuffer';

import { supabase } from '@/lib/supabase';

export type ProfileRole = 'customer' | 'worker' | 'agent';
export type IdVerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export type Profile = {
  id: string;
  role: ProfileRole;
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  skills: string[];
  idType?: string;
  idNumber?: string;
  idDocumentPath?: string;
  idVerificationStatus: IdVerificationStatus;
  referralCode?: string;
  recruitedBy?: string;
  assignedAgentId?: string;
  agentActive: boolean;
};

type ProfileRow = {
  id: string;
  role: ProfileRole;
  name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  skills: string[] | null;
  id_type: string | null;
  id_number: string | null;
  id_document_path: string | null;
  id_verification_status: IdVerificationStatus;
  referral_code: string | null;
  recruited_by: string | null;
  assigned_agent_id: string | null;
  agent_active: boolean;
};

function fromRow(row: ProfileRow): Profile {
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    location: row.location ?? undefined,
    skills: row.skills ?? [],
    idType: row.id_type ?? undefined,
    idNumber: row.id_number ?? undefined,
    idDocumentPath: row.id_document_path ?? undefined,
    idVerificationStatus: row.id_verification_status,
    referralCode: row.referral_code ?? undefined,
    recruitedBy: row.recruited_by ?? undefined,
    assignedAgentId: row.assigned_agent_id ?? undefined,
    agentActive: row.agent_active,
  };
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as ProfileRow) : null;
}

export type ProfileUpdate = Partial<{
  name: string;
  phone: string;
  location: string;
  skills: string[];
  idType: string;
  idNumber: string;
  idDocumentPath: string;
  idVerificationStatus: IdVerificationStatus;
}>;

export async function updateProfile(userId: string, update: ProfileUpdate): Promise<Profile> {
  const payload: Record<string, unknown> = {};
  if (update.name !== undefined) payload.name = update.name;
  if (update.phone !== undefined) payload.phone = update.phone;
  if (update.location !== undefined) payload.location = update.location;
  if (update.skills !== undefined) payload.skills = update.skills;
  if (update.idType !== undefined) payload.id_type = update.idType;
  if (update.idNumber !== undefined) payload.id_number = update.idNumber;
  if (update.idDocumentPath !== undefined) payload.id_document_path = update.idDocumentPath;
  if (update.idVerificationStatus !== undefined) payload.id_verification_status = update.idVerificationStatus;

  const { data, error } = await supabase.from('profiles').update(payload).eq('id', userId).select().single();
  if (error) throw error;
  return fromRow(data as ProfileRow);
}

export async function fetchRecruits(agentId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .or(`recruited_by.eq.${agentId},assigned_agent_id.eq.${agentId}`);
  if (error) throw error;
  return (data as ProfileRow[]).map(fromRow);
}

export type WorkerListing = {
  id: string;
  name: string;
  location?: string;
  skills: string[];
  idVerificationStatus: IdVerificationStatus;
  ratingAverage: number;
  ratingCount: number;
};

type WorkerListingRow = {
  id: string;
  name: string;
  location: string | null;
  skills: string[];
  id_verification_status: IdVerificationStatus;
  rating_average: string | number;
  rating_count: number;
};

// Only the columns safe to show any signed-in customer — see
// list_available_workers() in schema.sql, which hands these back without
// opening up SELECT on the rest of the profiles table. The rating is a
// pre-computed aggregate, not raw job rows, so it's safe to expose here too.
export async function fetchAvailableWorkers(): Promise<WorkerListing[]> {
  const { data, error } = await supabase.rpc('list_available_workers');
  if (error) throw error;
  return (data as WorkerListingRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    location: row.location ?? undefined,
    skills: row.skills,
    idVerificationStatus: row.id_verification_status,
    ratingAverage: Number(row.rating_average),
    ratingCount: row.rating_count,
  }));
}

// Uploads a base64-encoded ID photo to the private `id-documents` bucket under
// the user's own folder (required by the bucket's RLS policies) and returns
// the storage path to save on the profile.
export async function uploadIdDocument(userId: string, base64: string, extension: string): Promise<string> {
  const path = `${userId}/id-document.${extension}`;
  const contentType = extension === 'png' ? 'image/png' : 'image/jpeg';
  const { error } = await supabase.storage.from('id-documents').upload(path, decode(base64), {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  return path;
}
