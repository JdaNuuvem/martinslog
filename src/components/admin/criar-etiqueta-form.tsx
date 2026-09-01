'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

type Endereco = {
  nome: string
  documento: string
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
}

const ENDERECO_VAZIO: Endereco = {
  nome: '',
  documento: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
}

const CAMPOS_ENDERECO: { chave: keyof Endereco; rotulo: string; largura: string }[] = [
  { chave: 'nome', rotulo: 'Nome', largura: 'flex-1 min-w-[14rem]' },
  { chave: 'documento', rotulo: 'Documento (opcional)', largura: 'w-48' },
  { chave: 'cep', rotulo: 'CEP', largura: 'w-36' },
  { chave: 'logradouro', rotulo: 'Logradouro', largura: 'flex-1 min-w-[14rem]' },
  { chave: 'numero', rotulo: 'Número', largura: 'w-28' },
  { chave: 'complemento', rotulo: 'Complemento', largura: 'w-40' },
  { chave: 'bairro', rotulo: 'Bairro', largura: 'w-44' },
  { chave: 'cidade', rotulo: 'Cidade', largura: 'w-44' },
  { chave: 'uf', rotulo: 'UF', largura: 'w-20' },
]

function CamposEndereco({
  titulo,
  valor,
  aoMudar,
}: {
  titulo: string
  valor: Endereco
  aoMudar: (endereco: Endereco) => void
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-rotulo uppercase text-texto-secundario">{titulo}</legend>
      <div className="flex flex-wrap gap-3">
        {CAMPOS_ENDERECO.map((campo) => (
          <label key={campo.chave} className={`flex flex-col gap-1 text-sm ${campo.largura}`}>
            <span className="text-texto-secundario">{campo.rotulo}</span>
            <input
              type="text"
              value={valor[campo.chave]}
              onChange={(evento) => aoMudar({ ...valor, [campo.chave]: evento.target.value })}
              className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            />
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function paraCentavos(texto: string): number {
  const limpo = texto.trim().replace(/\./g, '').replace(',', '.')
  const numero = Number(limpo)
  return Number.isFinite(numero) ? Math.round(numero * 100) : 0
}

function semVazios(endereco: Endereco) {
  // `documento` e `complemento` são os únicos opcionais do schema do
  // servidor; mandar string vazia neles faria o Zod recusar por engano.
  const { documento, complemento, ...resto } = endereco
  return {
    ...resto,
    ...(documento.trim() ? { documento: documento.trim() } : {}),
    ...(complemento.trim() ? { complemento: complemento.trim() } : {}),
  }
}

/**
 * Criação de etiqueta em nome do cliente.
 *
 * Não há campo de preço: a rota cota a rota no servidor a partir do CEP, do
 * peso e das dimensões, e cobra a tarifa da cotação. Sem isso, o painel seria
 * um caminho para gravar qualquer valor em um envio — exatamente o que
 * `criarEnvio` recusa fazer pelo cliente.
 *
 * "Cobrar da carteira" é a única escolha exclusiva do administrador. Desligado,
 * o envio sai como cortesia: nenhum lançamento no extrato e o motivo registrado
 * na auditoria.
 */
export function CriarEtiquetaForm({ userId }: { userId: string }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [remetente, setRemetente] = useState(ENDERECO_VAZIO)
  const [destinatario, setDestinatario] = useState(ENDERECO_VAZIO)
  const [produtoNome, setProdutoNome] = useState('')
  const [quantidade, setQuantidade] = useState(1)
  const [valorUnitario, setValorUnitario] = useState('')
  const [pesoG, setPesoG] = useState(500)
  const [alturaCm, setAlturaCm] = useState(10)
  const [larguraCm, setLarguraCm] = useState(15)
  const [comprimentoCm, setComprimentoCm] = useState(20)
  const [formato, setFormato] = useState<'CAIXA' | 'ROLO' | 'ENVELOPE'>('CAIXA')
  const [cobrarSaldo, setCobrarSaldo] = useState(true)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<string | null>(null)

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErro(null)
    setSucesso(null)
    setEnviando(true)

    try {
      const resposta = await fetch(`/api/admin/usuarios/${userId}/etiquetas`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          remetente: semVazios(remetente),
          destinatario: semVazios(destinatario),
          produtos: [
            {
              nome: produtoNome,
              quantidade,
              valorUnitarioCentavos: paraCentavos(valorUnitario),
            },
          ],
          pesoG,
          alturaCm,
          larguraCm,
          comprimentoCm,
          formato,
          cobrarSaldo,
          motivo,
        }),
      })

      const dados = (await resposta.json().catch(() => ({}))) as {
        mensagem?: string
        codigoRastreio?: string | null
        precoCobradoCentavos?: number
      }

      if (!resposta.ok) {
        setErro(dados.mensagem ?? 'Não foi possível criar a etiqueta.')
        return
      }

      setSucesso(
        dados.codigoRastreio
          ? `Etiqueta criada. Código de rastreio: ${dados.codigoRastreio}.`
          : 'Etiqueta criada, mas o código de rastreio ainda não foi emitido. Reemita pela tela do envio.',
      )
      router.refresh()
    } catch {
      setErro('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setEnviando(false)
    }
  }

  if (!aberto) {
    return (
      <section className="flex items-center justify-between gap-4 rounded-xl bg-superficie-card p-6">
        <div>
          <h2 className="text-subtitulo font-semibold text-texto-principal">Criar etiqueta para o cliente</h2>
          <p className="text-sm text-texto-secundario">
            A tarifa é cotada no servidor pelos CEPs, peso e dimensões — igual ao fluxo do cliente.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Abrir formulário
        </button>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <div>
        <h2 className="text-subtitulo font-semibold text-texto-principal">Criar etiqueta para o cliente</h2>
        <p className="text-sm text-texto-secundario">
          Sem campo de preço: o valor vem da cotação gerada no servidor.
        </p>
      </div>

      <form onSubmit={enviar} className="flex flex-col gap-5">
        <CamposEndereco titulo="Remetente" valor={remetente} aoMudar={setRemetente} />
        <CamposEndereco titulo="Destinatário" valor={destinatario} aoMudar={setDestinatario} />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-rotulo uppercase text-texto-secundario">Conteúdo declarado</legend>
          <div className="flex flex-wrap gap-3">
            <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-sm">
              <span className="text-texto-secundario">Produto</span>
              <input
                type="text"
                value={produtoNome}
                onChange={(evento) => setProdutoNome(evento.target.value)}
                className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              />
            </label>
            <label className="flex w-28 flex-col gap-1 text-sm">
              <span className="text-texto-secundario">Qtd.</span>
              <input
                type="number"
                min={1}
                value={quantidade}
                onChange={(evento) => setQuantidade(Number(evento.target.value))}
                className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              />
            </label>
            <label className="flex w-40 flex-col gap-1 text-sm">
              <span className="text-texto-secundario">Valor unitário (R$)</span>
              <input
                type="text"
                inputMode="decimal"
                value={valorUnitario}
                onChange={(evento) => setValorUnitario(evento.target.value)}
                placeholder="49,90"
                className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-rotulo uppercase text-texto-secundario">Embalagem</legend>
          <div className="flex flex-wrap gap-3">
            <label className="flex w-32 flex-col gap-1 text-sm">
              <span className="text-texto-secundario">Peso (g)</span>
              <input
                type="number"
                min={1}
                value={pesoG}
                onChange={(evento) => setPesoG(Number(evento.target.value))}
                className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              />
            </label>
            {(
              [
                ['Altura (cm)', alturaCm, setAlturaCm],
                ['Largura (cm)', larguraCm, setLarguraCm],
                ['Compr. (cm)', comprimentoCm, setComprimentoCm],
              ] as const
            ).map(([rotulo, valor, definir]) => (
              <label key={rotulo} className="flex w-32 flex-col gap-1 text-sm">
                <span className="text-texto-secundario">{rotulo}</span>
                <input
                  type="number"
                  min={1}
                  step="0.1"
                  value={valor}
                  onChange={(evento) => definir(Number(evento.target.value))}
                  className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                />
              </label>
            ))}
            <label className="flex w-40 flex-col gap-1 text-sm">
              <span className="text-texto-secundario">Formato</span>
              <select
                value={formato}
                onChange={(evento) =>
                  setFormato(evento.target.value as 'CAIXA' | 'ROLO' | 'ENVELOPE')
                }
                className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                <option value="CAIXA">Caixa</option>
                <option value="ROLO">Rolo</option>
                <option value="ENVELOPE">Envelope</option>
              </select>
            </label>
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm text-texto-principal">
          <input
            type="checkbox"
            checked={cobrarSaldo}
            onChange={(evento) => setCobrarSaldo(evento.target.checked)}
          />
          Cobrar da carteira do cliente (desmarcado = cortesia, sem lançamento no extrato)
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Motivo (fica na auditoria)</span>
          <input
            type="text"
            value={motivo}
            maxLength={200}
            onChange={(evento) => setMotivo(evento.target.value)}
            placeholder="Reemissão da etiqueta perdida no chamado #482"
            className="rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          />
        </label>

        {erro ? (
          <p role="alert" className="text-sm text-erro">
            {erro}
          </p>
        ) : null}
        {sucesso ? (
          <p role="status" className="text-sm text-texto-principal">
            {sucesso}
          </p>
        ) : null}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={enviando}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            {enviando ? 'Criando…' : 'Criar etiqueta'}
          </button>
          <button
            type="button"
            onClick={() => setAberto(false)}
            className="rounded-lg border border-borda-campo px-4 py-2 text-sm text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            Fechar
          </button>
        </div>
      </form>
    </section>
  )
}
