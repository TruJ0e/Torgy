import type {MetadataRoute} from 'next';
export default function manifest():MetadataRoute.Manifest{return {name:'Torgy Academic Organizer',short_name:'Torgy',description:'Private, task-first academic organization.',start_url:'/',display:'standalone',background_color:'#f6f4ef',theme_color:'#716b62',icons:[{src:'/favicon.svg',sizes:'any',type:'image/svg+xml'}]}}
