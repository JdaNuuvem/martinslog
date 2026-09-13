'use client'

import type { ResumoConversa } from './api'
import { Avatar } from './avatar'
import { digitosParaDiscagem, nomeDoContato, telefoneFormatado } from './formatadores'
import { IconeBusca, IconeRobo, IconeTelefone, IconeVoltar } from './icones'

type CabecalhoProps = {
  conversa: ResumoConversa
  roboPausado: boolean
  alternandoRobo: boolean
  buscaAberta: boolean
  aoVoltar: () => void
  aoAlternarBusca: () => void
  aoAlternarRobo: () => void
}

const BOTAO =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-pilula text-[#54656f] hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

export function CabecalhoConversa(props: CabecalhoProps) {
  const { conversa, roboPausado, alternandoRobo, buscaAberta } = props
  const nome = nomeDoContato(conversa)
  const telefone = conversa.telefone ? telefoneFormatado(conversa.telefone) : null

  return (
    <header className="flex items-center gap-2 bg-[#f0f2f5] px-2 py-2 sm:px-4">
      <button type="button" onClick={props.aoVoltar} aria-label="Voltar para a lista de conversas" className={`${BOTAO} lg:hidden`}>
        <IconeVoltar />
      </button>

      <Avatar fotoUrl={conversa.fotoUrl} nome={conversa.nome} tamanho="cabecalho" />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <h2 className="truncate text-corpo font-medium text-[#111b21]">{nome}</h2>
        {telefone && telefone !== nome ? <p className="truncate text-rotulo text-[#667781]">{telefone}</p> : null}
      </div>

      {/*
        Ligar abre o discador de quem atende, e não uma chamada pelo WhatsApp:
        a integração do servidor não transporta voz — no máximo faria o
        celular do cliente tocar mudo. Um botão que parece ligar e não liga é
        pior que nenhum botão.
      */}
      {conversa.telefone ? (
        <a
          href={`tel:+${digitosParaDiscagem(conversa.telefone)}`}
          title="Liga pelo seu telefone (abre o discador deste aparelho)"
          aria-label={`Ligar para ${nome} pelo seu telefone`}
          className={BOTAO}
        >
          <IconeTelefone />
        </a>
      ) : (
        // aria-disabled em vez de disabled: botão desabilitado não mostra o
        // `title` no Chrome, e a dica é justamente a explicação do porquê.
        <button
          type="button"
          aria-disabled="true"
          title="O WhatsApp não informou o número deste contato"
          aria-label="Ligar indisponível: o WhatsApp não informou o número deste contato"
          onClick={(e) => e.preventDefault()}
          className={`${BOTAO} cursor-not-allowed opacity-50 hover:bg-transparent`}
        >
          <IconeTelefone />
        </button>
      )}

      <button
        type="button"
        onClick={props.aoAlternarBusca}
        aria-label="Pesquisar nesta conversa"
        aria-pressed={buscaAberta}
        className={`${BOTAO} ${buscaAberta ? 'bg-brand-bg text-brand-texto' : ''}`}
      >
        <IconeBusca />
      </button>

      {/*
        Assumir pausa o robô; devolver o solta antes do prazo. Os dois
        importam: sem o primeiro, robô e humano respondem juntos; sem o
        segundo, uma conversa atendida uma vez ficaria manual para sempre.
      */}
      <button
        type="button"
        onClick={props.aoAlternarRobo}
        disabled={alternandoRobo}
        aria-label={roboPausado ? 'Devolver a conversa ao robô' : 'Assumir a conversa do robô'}
        className={`flex shrink-0 items-center gap-2 rounded-pilula border px-3 py-1.5 text-dado font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60 ${
          roboPausado
            ? 'border-[#00a884] bg-[#d9fdd3] text-[#008069]'
            : 'border-[#d1d7db] bg-white text-[#54656f] hover:text-[#111b21]'
        }`}
      >
        <IconeRobo width={18} height={18} />
        <span className="hidden sm:inline">{roboPausado ? 'Devolver ao robô' : 'Assumir'}</span>
      </button>
    </header>
  )
}
