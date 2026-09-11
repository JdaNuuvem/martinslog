import { ConexaoEvolution } from '@/components/conexao-evolution'
import { ConexaoWhatsapp } from '@/components/conexao-whatsapp'
import { exigirSessaoNaPagina } from '@/server/auth/sessao-servidor'

export default async function PaginaWhatsapp() {
  /*
    A Evolution é só para administradores.
    Parear um celular copia a agenda do aparelho para este servidor, e quem
    faz isso precisa entender o que está aceitando. Deixar a opção à mão de
    todo lojista transforma uma decisão de infraestrutura em um botão
    convidativo na tela de configuração.
    A guarda de verdade está em `/api/evolution`, que responde 404 para quem
    não é admin. Esconder aqui só evita desenhar o que a API recusaria.
  */
  const sessao = await exigirSessaoNaPagina()
  const ehAdmin = sessao.papel === 'ADMIN'

  return (
    <div className="flex flex-col gap-secao">
      <div className="flex flex-col gap-2">
        <h1 className="text-titulo font-bold text-texto-principal">WhatsApp</h1>
        <p className="max-w-leitura text-corpo text-texto-secundario">
          Avise o comprador pelo WhatsApp oficial, com o número da sua loja.
        </p>
        {/*
          O aviso mora aqui porque é aqui que a expectativa se quebra: quem
          abre esta tela costuma achar que basta colar um token e começar a
          mandar. A verificação da empresa na Meta leva dias e é o portão que
          não tem atalho — saber disso antes evita a impressão de que o
          sistema está com defeito.
        */}
        <p className="max-w-leitura text-dado text-texto-secundario">
          O WhatsApp oficial exige verificação da sua empresa na Meta, com CNPJ e documentos. Esse
          passo acontece no painel deles e costuma levar alguns dias.
        </p>
      </div>

      <ConexaoWhatsapp />
      {ehAdmin ? <ConexaoEvolution /> : null}
    </div>
  )
}
