/* eslint-disable react/jsx-key --
   As células desta lista não são renderizadas como array: `TabelaResponsiva`
   coloca cada uma dentro do próprio `<td>` (ou `<div>`, no celular) e é ali
   que a chave é definida. A regra não enxerga essa indireção e cobra a chave
   no literal, onde ela não teria efeito nenhum. */
import Link from 'next/link'
import type { CanalMensagem, StatusMensagem } from '@prisma/client'
import { listarEmailsAdmin, listarMensagensAdmin } from '@/server/admin/consulta-mensagens'
import { AtualizaSozinho } from '@/components/admin/atualiza-sozinho'
import { TabelaResponsiva } from '@/components/admin/tabela-responsiva'

/**
 * O que já saiu para o comprador: SMS, WhatsApp e e-mail.
 *
 * Existe para responder à única pergunta que aparece quando alguém reclama —
 * "saiu?". Antes disto a resposta exigia consulta ao banco à mão, e a diferença
 * entre "o provedor recusou" e "o canal nunca foi ligado" ficava invisível.
 *
 * Os e-mails vivem em outra tabela e por isso são outra aba, não outra coluna:
 * juntar as duas numa lista só custaria caro e ordenaria mal.
 */
export const dynamic = 'force-dynamic'

const CANAIS: { valor: CanalMensagem; rotulo: string }[] = [
  { valor: 'SMS', rotulo: 'SMS' },
  { valor: 'WHATSAPP', rotulo: 'WhatsApp' },
]

const SITUACOES: { valor: StatusMensagem; rotulo: string }[] = [
  { valor: 'ENVIADA', rotulo: 'Enviadas' },
  { valor: 'PENDENTE', rotulo: 'Na fila' },
  // `FALHA` fica na lista porque o enum a tem e um dado antigo pode carregá-la;
  // o que o sistema grava hoje é `DESISTIU`.
  { valor: 'DESISTIU', rotulo: 'Não chegaram' },
  { valor: 'FALHA', rotulo: 'Falharam' },
]

type Busca = { tipo?: string; canal?: string; status?: string; busca?: string; pagina?: string }

function quando(valor: Date | null): string {
  return valor ? valor.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
}

function telefone(bruto: string): string {
  const d = bruto.replace(/\D/g, '').replace(/^55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return bruto
}

function canalValido(valor?: string): CanalMensagem | undefined {
  return CANAIS.some((c) => c.valor === valor) ? (valor as CanalMensagem) : undefined
}

function situacaoValida(valor?: string): StatusMensagem | undefined {
  return SITUACOES.some((s) => s.valor === valor) ? (valor as StatusMensagem) : undefined
}

function comParametros(atuais: Busca, mudanca: Partial<Busca>): string {
  const p = new URLSearchParams()
  for (const [chave, valor] of Object.entries({ ...atuais, ...mudanca })) {
    if (valor) p.set(chave, String(valor))
  }
  const query = p.toString()
  return query ? `/admin/mensagens?${query}` : '/admin/mensagens'
}

const CAMPO =
  'rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

const PILULA =
  'rounded-pilula px-3 py-1.5 text-sm focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

/** Cor da etiqueta de situação. Falha e desistência são o que se procura. */
function corDaSituacao(status: StatusMensagem): string {
  if (status === 'ENVIADA') return 'bg-sucesso/15 text-sucesso'
  if (status === 'PENDENTE') return 'bg-atencao/15 text-atencao'
  return 'bg-erro/15 text-erro'
}

export default async function PaginaMensagens({
  searchParams,
}: {
  searchParams: Promise<Busca>
}) {
  const parametros = await searchParams
  const emails = parametros.tipo === 'email'
  const pagina = Number(parametros.pagina) || 1

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-titulo font-bold text-texto-principal">Mensagens</h1>
        <p className="max-w-leitura text-corpo text-texto-secundario">
          Tudo que saiu para o comprador, com o destino real e o motivo de cada falha. “Enviada”
          quer dizer que o provedor aceitou; “entregue” é a operadora confirmando no aparelho — e
          nem toda operadora confirma.
        </p>
        <AtualizaSozinho segundos={30} />
      </div>

      <nav aria-label="Tipo de mensagem" className="flex flex-wrap gap-2">
        <Link
          href="/admin/mensagens"
          aria-current={emails ? undefined : 'page'}
          className={`${PILULA} ${emails ? 'bg-superficie-card text-texto-principal' : 'bg-brand text-white'}`}
        >
          SMS e WhatsApp
        </Link>
        <Link
          href="/admin/mensagens?tipo=email"
          aria-current={emails ? 'page' : undefined}
          className={`${PILULA} ${emails ? 'bg-brand text-white' : 'bg-superficie-card text-texto-principal'}`}
        >
          E-mails
        </Link>
      </nav>

      <form method="get" className="flex flex-wrap items-end gap-3">
        {emails ? <input type="hidden" name="tipo" value="email" /> : null}
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-dado sm:flex-none">
          <span className="text-texto-secundario">
            {emails ? 'Destinatário, assunto ou evento' : 'Telefone ou evento'}
          </span>
          <input
            type="search"
            name="busca"
            defaultValue={parametros.busca ?? ''}
            placeholder={emails ? 'maria@… ou PEDIDO_PAGO' : '11988887777 ou POSTADO'}
            className={`${CAMPO} w-full sm:w-72`}
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Filtrar
        </button>
        <Link
          href={emails ? '/admin/mensagens?tipo=email' : '/admin/mensagens'}
          className="rounded-lg border border-borda-campo px-4 py-2 text-sm text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Limpar
        </Link>
      </form>

      {emails ? (
        <AbaEmails busca={parametros.busca} pagina={pagina} parametros={parametros} />
      ) : (
        <AbaMensagens parametros={parametros} pagina={pagina} />
      )}
    </>
  )
}

async function AbaMensagens({ parametros, pagina }: { parametros: Busca; pagina: number }) {
  const canal = canalValido(parametros.canal)
  const lista = await listarMensagensAdmin({
    canal,
    status: situacaoValida(parametros.status),
    busca: parametros.busca,
    pagina,
  })

  const porCanal = new Map(lista.porCanal.map((c) => [c.canal, c.total]))
  const totalGeral = lista.porCanal.reduce((soma, c) => soma + c.total, 0)

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Link
          href={comParametros(parametros, { canal: undefined, pagina: undefined })}
          aria-current={canal ? undefined : 'page'}
          className={`${PILULA} ${canal ? 'bg-superficie-card text-texto-principal' : 'bg-brand text-white'}`}
        >
          Todos os canais ({totalGeral.toLocaleString('pt-BR')})
        </Link>
        {CANAIS.map((item) => (
          <Link
            key={item.valor}
            href={comParametros(parametros, { canal: item.valor, pagina: undefined })}
            aria-current={canal === item.valor ? 'page' : undefined}
            className={`${PILULA} ${
              canal === item.valor ? 'bg-brand text-white' : 'bg-superficie-card text-texto-principal'
            }`}
          >
            {item.rotulo} ({(porCanal.get(item.valor) ?? 0).toLocaleString('pt-BR')})
          </Link>
        ))}
        {/*
          Atalho de operação, não filtro decorativo: é por ele que se começa
          quando alguém diz que a mensagem não chegou.

          Aponta para `DESISTIU`, e não para `FALHA`: `FALHA` está no enum e
          ninguém o escreve, então a pílula mostrava "0" para sempre enquanto
          as recusas de verdade estavam logo ao lado.
        */}
        <Link
          href={comParametros(parametros, { status: 'DESISTIU', pagina: undefined })}
          aria-current={parametros.status === 'DESISTIU' ? 'page' : undefined}
          className={`${PILULA} ${
            parametros.status === 'DESISTIU' ? 'bg-erro text-white' : 'bg-erro/10 text-erro'
          }`}
        >
          Não chegaram ({lista.falhas.toLocaleString('pt-BR')})
        </Link>
      </div>

      <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-4 sm:p-6">
        <h2 className="text-subtitulo font-semibold text-texto-principal">
          {lista.total.toLocaleString('pt-BR')} mensage{lista.total === 1 ? 'm' : 'ns'}
          {lista.paginas > 1 ? ` — página ${lista.pagina} de ${lista.paginas}` : ''}
        </h2>

        <TabelaResponsiva
          vazio="Nenhuma mensagem com esses filtros."
          colunas={[
            { rotulo: 'Para', principal: true },
            { rotulo: 'Canal' },
            { rotulo: 'Evento' },
            { rotulo: 'Loja' },
            { rotulo: 'Situação' },
            { rotulo: 'Pedido / rastreio' },
            { rotulo: 'Quando' },
          ]}
          linhas={lista.mensagens.map((m) => ({
            chave: m.id,
            celulas: [
              <span className="font-medium text-texto-principal">{telefone(m.para)}</span>,
              <>
                <span className="text-texto-principal">{m.canal}</span>
                {m.provedor ? (
                  <>
                    <br />
                    <span className="text-texto-secundario">{m.provedor}</span>
                  </>
                ) : null}
              </>,
              <span className="text-texto-secundario">{m.evento}</span>,
              <span className="text-texto-secundario">{m.loja}</span>,
              <>
                <span
                  className={`inline-block rounded px-2 py-0.5 text-rotulo ${corDaSituacao(m.status)}`}
                >
                  {SITUACOES.find((s) => s.valor === m.status)?.rotulo ?? m.status}
                </span>
                {m.erro ? (
                  <>
                    <br />
                    <span className="break-words text-rotulo text-erro">{m.erro}</span>
                  </>
                ) : null}
                {m.tentativas > 1 ? (
                  <>
                    <br />
                    <span className="text-rotulo text-texto-secundario">
                      {m.tentativas} tentativas
                    </span>
                  </>
                ) : null}
              </>,
              <>
                {m.pedido ? <span className="text-texto-secundario">{m.pedido}</span> : null}
                {m.codigoRastreio ? (
                  <>
                    {m.pedido ? <br /> : null}
                    <a
                      href={`/r/${m.codigoRastreio}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-texto underline underline-offset-2"
                    >
                      {m.codigoRastreio}
                    </a>
                  </>
                ) : null}
                {!m.pedido && !m.codigoRastreio ? (
                  <span className="text-texto-secundario">—</span>
                ) : null}
              </>,
              <span className="text-texto-secundario">
                {quando(m.criadoEm)}
                {m.entregueEm ? (
                  <>
                    <br />
                    <span className="text-sucesso">no aparelho {quando(m.entregueEm)}</span>
                  </>
                ) : null}
              </span>,
            ],
          }))}
        />

        <Paginacao
          pagina={lista.pagina}
          paginas={lista.paginas}
          parametros={parametros}
        />
      </section>
    </>
  )
}

async function AbaEmails({
  busca,
  pagina,
  parametros,
}: {
  busca?: string
  pagina: number
  parametros: Busca
}) {
  const lista = await listarEmailsAdmin({ busca, pagina })

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-4 sm:p-6">
      <h2 className="text-subtitulo font-semibold text-texto-principal">
        {lista.total.toLocaleString('pt-BR')} e-mail{lista.total === 1 ? '' : 's'}
        {lista.falhas > 0 ? ` — ${lista.falhas.toLocaleString('pt-BR')} sem confirmação de envio` : ''}
        {lista.paginas > 1 ? ` — página ${lista.pagina} de ${lista.paginas}` : ''}
      </h2>

      <TabelaResponsiva
        vazio="Nenhum e-mail com esses filtros."
        colunas={[
          { rotulo: 'Para', principal: true },
          { rotulo: 'Assunto' },
          { rotulo: 'Evento' },
          { rotulo: 'Conta' },
          { rotulo: 'Situação' },
          { rotulo: 'Rastreio' },
          { rotulo: 'Quando' },
        ]}
        linhas={lista.emails.map((e) => ({
          chave: e.id,
          celulas: [
            <span className="font-medium text-texto-principal">{e.para}</span>,
            <span className="text-texto-principal">{e.assunto}</span>,
            <span className="text-texto-secundario">{e.evento}</span>,
            <span className="text-texto-secundario">{e.conta}</span>,
            <>
              <span
                className={`inline-block rounded px-2 py-0.5 text-rotulo ${
                  e.status === 'ENVIADO' ? 'bg-sucesso/15 text-sucesso' : 'bg-erro/15 text-erro'
                }`}
              >
                {e.status}
              </span>
              {e.erro ? (
                <>
                  <br />
                  <span className="break-words text-rotulo text-erro">{e.erro}</span>
                </>
              ) : null}
            </>,
            e.codigoRastreio ? (
              <a
                href={`/r/${e.codigoRastreio}`}
                target="_blank"
                rel="noreferrer"
                className="text-brand-texto underline underline-offset-2"
              >
                {e.codigoRastreio}
              </a>
            ) : (
              <span className="text-texto-secundario">—</span>
            ),
            <span className="text-texto-secundario">{quando(e.criadoEm)}</span>,
          ],
        }))}
      />

      <Paginacao pagina={lista.pagina} paginas={lista.paginas} parametros={parametros} />
    </section>
  )
}

function Paginacao({
  pagina,
  paginas,
  parametros,
}: {
  pagina: number
  paginas: number
  parametros: Busca
}) {
  if (paginas <= 1) return null

  return (
    <nav aria-label="Páginas" className="flex items-center gap-3">
      {pagina > 1 ? (
        <Link
          href={comParametros(parametros, { pagina: String(pagina - 1) })}
          className="rounded-lg border border-borda-campo px-3 py-1.5 text-sm text-texto-principal"
        >
          Anterior
        </Link>
      ) : null}
      {pagina < paginas ? (
        <Link
          href={comParametros(parametros, { pagina: String(pagina + 1) })}
          className="rounded-lg border border-borda-campo px-3 py-1.5 text-sm text-texto-principal"
        >
          Próxima
        </Link>
      ) : null}
    </nav>
  )
}
