export default async function handler(req,res){
  const r = await fetch("https://api.paychangu.com/mobile-money",{
    headers:{
      "Authorization": `Bearer ${process.env.PAYCHANGU_SECRET}`,
      "Accept":"application/json"
    }
  });
  const data = await r.json();
  return res.status(200).json(data);
}
