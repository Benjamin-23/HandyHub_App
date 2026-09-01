import { supabase } from '@/lib/supabase';

export type JobStatus = 'open' | 'negotiating' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';
export type JobPayType = 'hourly' | 'task';
export type JobOfferBy = 'customer' | 'worker';
export type JobPaymentMethod = 'in_app' | 'direct';

export type Job = {
  id: string;
  customerId: string;
  workerId?: string;
  category: string;
  service: string;
  payType: JobPayType;
  location?: string;
  scheduledAt?: string;
  // Who last set the current scheduledAt, and whether the other side has
  // confirmed it — a change by the worker needs the customer to confirm.
  scheduleSetBy?: JobOfferBy;
  scheduleConfirmed: boolean;
  listedPrice?: number;
  currentOffer?: number;
  offerBy?: JobOfferBy;
  finalPrice?: number;
  status: JobStatus;
  completedAt?: string;
  createdAt: string;
  customerName?: string;
  workerName?: string;
  rating?: number;
  // HandyHub's 10% cut, set automatically when the job completes.
  commission?: number;
  remitted: boolean;
  remittedAt?: string;
  // How the customer paid — through the app (commission auto-remitted) or
  // directly to the worker in cash/mobile money (worker remits manually).
  paymentMethod?: JobPaymentMethod;
  transactionCode?: string;
  // Only ever populated for the customer's own fetch — see fetchWorkerJobs.
  completionCode?: string;
};

type JobRow = {
  id: string;
  customer_id: string;
  worker_id: string | null;
  category: string;
  service: string;
  pay_type: JobPayType;
  location: string | null;
  scheduled_at: string | null;
  schedule_set_by: JobOfferBy | null;
  schedule_confirmed: boolean;
  listed_price: string | number | null;
  current_offer: string | number | null;
  offer_by: JobOfferBy | null;
  final_price: string | number | null;
  status: JobStatus;
  completed_at: string | null;
  created_at: string;
  rating: number | null;
  commission: string | number | null;
  remitted: boolean;
  remitted_at: string | null;
  payment_method: JobPaymentMethod | null;
  transaction_code: string | null;
  completion_code?: string | null;
  customer?: { name: string } | null;
  worker?: { name: string } | null;
};

const NAME_JOINS = 'customer:profiles!jobs_customer_id_fkey(name), worker:profiles!jobs_worker_id_fkey(name)';

// Includes the completion code — only ever used for the customer's own jobs,
// since they're the one who reads it out to the worker in person.
const SELECT_FOR_CUSTOMER = `*, ${NAME_JOINS}`;

// Everything a worker needs, minus completion_code — so the code that proves
// a job is done never reaches the worker's client at all, only their submission of it.
const SELECT_FOR_WORKER = `
  id, customer_id, worker_id, category, service, pay_type, location, scheduled_at,
  schedule_set_by, schedule_confirmed, listed_price, current_offer, offer_by, final_price,
  status, completed_at, created_at, rating, commission, remitted, remitted_at,
  payment_method, transaction_code,
  ${NAME_JOINS}
`;

function toNumber(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  return typeof value === 'number' ? value : Number(value);
}

function fromRow(row: JobRow): Job {
  return {
    id: row.id,
    customerId: row.customer_id,
    workerId: row.worker_id ?? undefined,
    category: row.category,
    service: row.service,
    payType: row.pay_type,
    location: row.location ?? undefined,
    scheduledAt: row.scheduled_at ?? undefined,
    scheduleSetBy: row.schedule_set_by ?? undefined,
    scheduleConfirmed: row.schedule_confirmed,
    listedPrice: toNumber(row.listed_price),
    currentOffer: toNumber(row.current_offer),
    offerBy: row.offer_by ?? undefined,
    finalPrice: toNumber(row.final_price),
    status: row.status,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    customerName: row.customer?.name,
    workerName: row.worker?.name,
    rating: row.rating ?? undefined,
    commission: toNumber(row.commission),
    remitted: row.remitted,
    remittedAt: row.remitted_at ?? undefined,
    paymentMethod: row.payment_method ?? undefined,
    transactionCode: row.transaction_code ?? undefined,
    completionCode: row.completion_code ?? undefined,
  };
}

export async function fetchCustomerJobs(customerId: string): Promise<Job[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select(SELECT_FOR_CUSTOMER)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as unknown as JobRow[]).map(fromRow);
}

// RLS already limits what comes back to jobs this worker has claimed, plus
// open jobs whose category is covered by their skills — no extra filter needed.
export async function fetchWorkerJobs(): Promise<Job[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select(SELECT_FOR_WORKER)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as unknown as JobRow[]).map(fromRow);
}

export async function postJob(params: {
  customerId: string;
  category: string;
  service: string;
  payType: JobPayType;
  location?: string;
  scheduledAt?: string;
  offer?: number;
  // Booking a specific real worker skips the open marketplace — the job
  // goes straight to them, in "negotiating" so it's immediately their turn
  // to accept or counter. Omit to post it open to any matching worker.
  workerId?: string;
}): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .insert({
      customer_id: params.customerId,
      worker_id: params.workerId,
      category: params.category,
      service: params.service,
      pay_type: params.payType,
      location: params.location,
      scheduled_at: params.scheduledAt,
      listed_price: params.offer,
      current_offer: params.offer,
      offer_by: params.offer !== undefined ? 'customer' : null,
      status: params.workerId ? 'negotiating' : 'open',
    })
    .select(SELECT_FOR_WORKER)
    .single();
  if (error) throw error;
  return fromRow(data as unknown as JobRow);
}

// A matching worker claims an open job — either accepting the customer's
// asking price outright, or opening negotiation with a counter-offer.
export async function claimJob(jobId: string, workerId: string, counterOffer?: number): Promise<Job> {
  const patch: Record<string, unknown> = { worker_id: workerId };
  if (counterOffer !== undefined) {
    patch.current_offer = counterOffer;
    patch.offer_by = 'worker';
    patch.status = 'negotiating';
  } else {
    patch.status = 'accepted';
  }
  const { data, error } = await supabase.from('jobs').update(patch).eq('id', jobId).select(SELECT_FOR_WORKER).single();
  if (error) throw error;
  return fromRow(data as unknown as JobRow);
}

// Either side proposes a new price on an already-claimed job.
export async function counterOffer(jobId: string, amount: number, by: JobOfferBy): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .update({ current_offer: amount, offer_by: by, status: 'negotiating' })
    .eq('id', jobId)
    .select(SELECT_FOR_WORKER)
    .single();
  if (error) throw error;
  return fromRow(data as unknown as JobRow);
}

// Either side accepts the other's current offer, locking in the final price.
export async function acceptOffer(jobId: string, finalPrice: number): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .update({ status: 'accepted', final_price: finalPrice })
    .eq('id', jobId)
    .select(SELECT_FOR_WORKER)
    .single();
  if (error) throw error;
  return fromRow(data as unknown as JobRow);
}

export async function startJob(jobId: string): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .update({ status: 'in_progress' })
    .eq('id', jobId)
    .select(SELECT_FOR_WORKER)
    .single();
  if (error) throw error;
  return fromRow(data as unknown as JobRow);
}

// Verified server-side (see the complete_job() function in schema.sql) so the
// worker's client never needs to read the stored code — only what the
// customer told them in person once the job was actually done.
export async function completeJobWithCode(jobId: string, code: string): Promise<Job> {
  const { data, error } = await supabase.rpc('complete_job', { job_id: jobId, code });
  if (error) throw error;
  return fromRow(data as unknown as JobRow);
}

// Either side can adjust the location or scheduled date/time while still
// negotiating — the description and category are never editable by either
// side, and the DB rejects any edit once a price is agreed
// (see jobs_lock_details_after_agreement).
export async function updateJobDetails(jobId: string, updates: { location?: string; scheduledAt?: string }): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .update({ location: updates.location, scheduled_at: updates.scheduledAt })
    .eq('id', jobId)
    .select(SELECT_FOR_WORKER)
    .single();
  if (error) throw error;
  return fromRow(data as unknown as JobRow);
}

// Only returns a number once the job is matched (worker_id set) and the
// caller is a participant — see get_job_counterpart_phone() in schema.sql.
export async function fetchJobCounterpartPhone(jobId: string): Promise<string | undefined> {
  const { data, error } = await supabase.rpc('get_job_counterpart_phone', { p_job_id: jobId });
  if (error) throw error;
  return (data as string | null) ?? undefined;
}

// Customer confirms a time the worker proposed.
export async function confirmSchedule(jobId: string): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .update({ schedule_confirmed: true })
    .eq('id', jobId)
    .select(SELECT_FOR_WORKER)
    .single();
  if (error) throw error;
  return fromRow(data as unknown as JobRow);
}

// Only the customer, only once, only on a completed job — enforced by
// jobs_lock_rating() in schema.sql.
export async function rateJob(jobId: string, rating: number): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .update({ rating })
    .eq('id', jobId)
    .select(SELECT_FOR_WORKER)
    .single();
  if (error) throw error;
  return fromRow(data as unknown as JobRow);
}

// Customer records how they paid — through the app (commission gets
// auto-remitted the moment the job completes) or directly to the worker
// (a transaction code is required as a record of it, and the worker still
// owes the 10% commission afterward). Enforced by jobs_lock_payment_method()
// in schema.sql; only allowed before the job is completed.
export async function recordPayment(jobId: string, method: JobPaymentMethod, transactionCode?: string): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .update({ payment_method: method, transaction_code: transactionCode })
    .eq('id', jobId)
    .select(SELECT_FOR_WORKER)
    .single();
  if (error) throw error;
  return fromRow(data as unknown as JobRow);
}

// Worker marks their own completed job's 10% commission as remitted (paid
// to HandyHub) — enforced by jobs_lock_remit() in schema.sql.
export async function remitJob(jobId: string): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .update({ remitted: true })
    .eq('id', jobId)
    .select(SELECT_FOR_WORKER)
    .single();
  if (error) throw error;
  return fromRow(data as unknown as JobRow);
}

export type RatingSummary = { average: number; count: number };

// A worker can already read their own jobs (RLS: worker_id = auth.uid()), so
// this just pulls the rated ones and averages client-side — no new RPC needed.
export async function fetchWorkerRatingSummary(workerId: string): Promise<RatingSummary> {
  const { data, error } = await supabase
    .from('jobs')
    .select('rating')
    .eq('worker_id', workerId)
    .not('rating', 'is', null);
  if (error) throw error;
  const ratings = (data as { rating: number }[]).map((row) => row.rating);
  if (ratings.length === 0) return { average: 0, count: 0 };
  const average = ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
  return { average, count: ratings.length };
}
