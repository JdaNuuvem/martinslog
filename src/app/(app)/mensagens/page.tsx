import { CampanhasWhatsapp } from '@/components/campanhas-whatsapp'
import { RespostasRobo } from '@/components/respostas-robo'
import { TextosAutomaticos } from '@/components/textos-automaticos'
import { exigirSessaoNaPagina } from '@/server/auth/sessao-servidor'

export default async function PaginaMensagens() {
  const sessao = await exigirSessaoNaPagina()

  /*
    Os textos de cada etapa são do lojista: escrever como a loja fala com o
    comprador é trabalho dele, e é o que estava faltando.

    Robô e campanhas ficam com o administrador porque dependem da Evolution,
    que é restrita — e campanha, além disso, é o recurso que pode custar o
    número. Mostrar a quem não pode usar só gera pedido de acesso.
  */
  const ehAdmin = sessao.papel === 'ADMIN'

  return (
    <div className="flex flex-col gap-secao">
      <div className="flex flex-col gap-2">
        <h1 className="text-titulo font-bold text-texto-principal">Mensagens</h1>
        <p className="max-w-leitura text-corpo text-texto-secundario">
          O que sai sozinho para o comprador a cada etapa do pedido, e o que o robô responde quando
          ele escreve de volta.
        </p>
      </div>

      <TextosAutomaticos />
      {ehAdmin ? <RespostasRobo /> : null}
      {ehAdmin ? <CampanhasWhatsapp /> : null}
    </div>
  )
}
