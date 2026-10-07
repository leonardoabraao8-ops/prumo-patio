-- Modo fotos (guincheiros) + leitura do pátio só para editor/visualizador.
-- Rodar inteiro no Supabase → SQL Editor → New query → Run.

create or replace function public.pode_ler() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel from perfis where id = auth.uid()), 'guincheiro') in ('editor','visualizador');
$$;

drop policy if exists "logados leem veiculos" on public.veiculos;
create policy "equipe le veiculos" on public.veiculos for select to authenticated using (public.pode_ler());
drop policy if exists "logados leem eventos" on public.eventos;
create policy "equipe le eventos" on public.eventos for select to authenticated using (public.pode_ler());
drop policy if exists "logados leem apagados" on public.apagados;
create policy "equipe le apagados" on public.apagados for select to authenticated using (public.pode_ler());
drop policy if exists "logados leem enderecos" on public.enderecos;
create policy "equipe le enderecos" on public.enderecos for select to authenticated using (public.pode_ler());
drop policy if exists "historico do que me pertence" on public.alteracoes;
create policy "historico do que me pertence" on public.alteracoes for select to authenticated using (
  ((tabela = any (array['veiculos','eventos'])) and public.pode_ler())
  or public.pode_editar()
  or exists (select 1 from abastecimentos a where a.id = alteracoes.registro and a.quem = (select auth.uid()))
);

create table if not exists public.fotos_registro (
  id uuid primary key default gen_random_uuid(),
  veiculo uuid not null references public.veiculos(id) on delete cascade,
  angulo text not null,
  url text not null,
  autor uuid default auth.uid(),
  criado timestamptz not null default now()
);
create index if not exists fotos_registro_veiculo on public.fotos_registro(veiculo);
alter table public.fotos_registro enable row level security;
drop policy if exists "equipe ou autor le registro de fotos" on public.fotos_registro;
create policy "equipe ou autor le registro de fotos" on public.fotos_registro for select to authenticated
  using (public.pode_ler() or autor = (select auth.uid()));

create or replace function public.fotos_pendentes()
returns table(id uuid, placa text, modelo text, status text, entrada timestamptz, direta boolean, angulos text[])
language sql stable security definer set search_path = public as $$
  select v.id, v.placa, v.modelo, v.status, v.entrada, coalesce(v.direta,false),
         coalesce((select array_agg(distinct r.angulo) from fotos_registro r where r.veiculo = v.id), '{}')
  from veiculos v
  where auth.uid() is not null
    and coalesce((select papel from perfis where id = auth.uid()), 'guincheiro') in ('guincheiro','editor')
    and v.status <> 'Entregue'
    and coalesce(v.arquivado, false) = false
  order by v.entrada desc;
$$;

create or replace function public.registrar_foto(p_veiculo uuid, p_angulo text, p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_fotos jsonb;
  v_antiga text;
begin
  if auth.uid() is null or coalesce((select papel from perfis where id = auth.uid()), 'guincheiro') not in ('guincheiro','editor') then
    raise exception 'sem permissão';
  end if;
  if p_url !~ '^https://tbdeoytkiqhzadtbuazs\.supabase\.co/storage/v1/object/public/fotos/[a-z0-9-]+\.jpg$' then
    raise exception 'endereço de foto inválido';
  end if;
  if p_angulo !~ '^[a-z_]{2,20}$' then raise exception 'ângulo inválido'; end if;
  select coalesce(nullif(fotos,'')::jsonb, '[]'::jsonb) into v_fotos
    from veiculos where id = p_veiculo and status <> 'Entregue' for update;
  if not found then raise exception 'veículo não encontrado'; end if;
  if p_angulo <> 'extra' then
    select url into v_antiga from fotos_registro where veiculo = p_veiculo and angulo = p_angulo order by criado desc limit 1;
    if v_antiga is not null then
      v_fotos := coalesce((select jsonb_agg(x) from jsonb_array_elements(v_fotos) x where x #>> '{}' <> v_antiga), '[]'::jsonb);
      delete from fotos_registro where veiculo = p_veiculo and angulo = p_angulo;
    end if;
  end if;
  v_fotos := v_fotos || to_jsonb(p_url);
  update veiculos set fotos = v_fotos::text where id = p_veiculo;
  insert into fotos_registro(veiculo, angulo, url) values (p_veiculo, p_angulo, p_url);
end $$;

revoke all on function public.registrar_foto(uuid,text,text) from public, anon;
grant execute on function public.registrar_foto(uuid,text,text) to authenticated;
revoke all on function public.fotos_pendentes() from public, anon;
grant execute on function public.fotos_pendentes() to authenticated;
